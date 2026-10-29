import { describe, expect } from "bun:test";

// @effect-diagnostics strictEffectProvide:off
import { Effect, Option, Queue, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";

import { License } from "../electron/license.ts";
import {
  startUpdates,
  UpdateCheckFailed,
  UpdateFeed,
  type FoundUpdate,
  type UpdateNotices,
  UpdateStatus,
} from "../electron/updates.ts";
import { eventually, it } from "./effect.ts";
import { warnings } from "./support.ts";

const fakeFeed = Effect.fnUntraced(function* (
  answers: ReadonlyArray<Option.Option<FoundUpdate> | UpdateCheckFailed>,
) {
  const checks = yield* Ref.make(0);
  const installs = yield* Ref.make(0);
  const fetched = yield* Ref.make(0);
  const downloads = yield* Queue.unbounded<string>();
  const progress = yield* Queue.unbounded<number>();
  const errors = yield* Queue.unbounded<string>();

  const check = Effect.flatMap(
    Ref.getAndUpdate(checks, (n) => n + 1),
    (n) => {
      const answer = answers[Math.min(n, answers.length - 1)] ?? Option.none();

      return answer instanceof UpdateCheckFailed ? Effect.fail(answer) : Effect.succeed(answer);
    },
  );

  const feed = UpdateFeed.of({
    enabled: true,
    check,
    download: Ref.update(fetched, (n) => n + 1),
    downloaded: Stream.fromQueue(downloads),
    progress: Stream.fromQueue(progress),
    errors: Stream.fromQueue(errors),
    quitAndInstall: Ref.update(installs, (n) => n + 1),
  });

  return { feed, checks, installs, fetched, downloads, progress, errors };
});

const shown = (status: UpdateStatus) =>
  [
    status._tag,
    "version" in status ? status.version : "",
    "percent" in status ? status.percent : "",
  ]
    .join(" ")
    .trim();

/** What the board heard, a line each. */
const fakeBoard = Effect.gen(function* () {
  const heard = yield* Ref.make<ReadonlyArray<string>>([]);
  const hear = (line: string) => Ref.update(heard, (all) => [...all, line]);

  const notices: UpdateNotices = {
    status: (status) => hear(shown(status)),
    upToDate: hear("up to date"),
    failed: (message) => hear(`failed: ${message}`),
  };

  return { notices, heard: Ref.get(heard) };
});

const found = (version: string, available = true, releasedAt = Option.none<number>()) =>
  Option.some({ available, version, releasedAt });

const UPDATES_ENDED = Date.parse("2027-10-20T00:00:00Z");

/** A license that covers every version, as the free version's and a plan's do. */
const coversAll = License.of({
  setKey: () => Effect.succeed("granted"),
  refresh: Effect.void,
  hasKey: Effect.succeed(false),
  deactivate: Effect.succeed("deactivated"),
  updatesEnd: Effect.succeedNone,
  covers: () => Effect.succeed(true),
  renewal: () => Effect.succeedNone,
});

/**
 * A perpetual license whose updates ended at UPDATES_ENDED, until `renewed` says a renewal came
 * through, which the next look counts.
 */
const licenseEnding = (renewed: Ref.Ref<boolean>) =>
  License.of({
    ...coversAll,
    hasKey: Effect.succeed(true),
    updatesEnd: Effect.succeedSome(UPDATES_ENDED),
    covers: (releasedAt) =>
      Effect.map(Ref.get(renewed), (yes) => yes || releasedAt <= UPDATES_ENDED),
  });

/** Starts updates on `feed`, with a license that covers every version unless one is given. */
const start = (
  notices: UpdateNotices,
  feed: UpdateFeed["Service"],
  license: License["Service"] = coversAll,
) =>
  startUpdates(notices).pipe(
    Effect.provideService(UpdateFeed, feed),
    Effect.provideService(License, license),
  );

describe("updating in the background", () => {
  it.effect("checks at launch and every four hours, a failed check waiting for the next", () =>
    Effect.gen(function* () {
      const { feed, checks } = yield* fakeFeed([
        new UpdateCheckFailed({ message: "offline" }),
        Option.none(),
      ]);

      const board = yield* fakeBoard;

      yield* start(board.notices, feed);
      yield* TestClock.adjust("0 millis");

      expect(yield* Ref.get(checks)).toBe(1);

      yield* TestClock.adjust("4 hours");
      yield* TestClock.adjust("4 hours");

      expect(yield* Ref.get(checks)).toBe(3);
      expect(yield* board.heard).toEqual([]);
    }),
  );

  it.effect("leaves a warning in the log when a check in the background fails", () =>
    Effect.gen(function* () {
      const { feed } = yield* fakeFeed([new UpdateCheckFailed({ message: "offline" })]);
      const board = yield* fakeBoard;
      const logged = yield* warnings;

      yield* start(board.notices, feed).pipe(Effect.provide(logged.layer));
      yield* TestClock.adjust("0 millis");

      expect((yield* logged.lines).join("\n")).toContain("Checking for updates failed");
    }),
  );

  it.live("shows a download only once it's ready, and restarting installs it", () =>
    Effect.gen(function* () {
      const { feed, installs, downloads, progress } = yield* fakeFeed([Option.none()]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      const restart = Effect.flatMap(
        updates.install,
        Option.getOrElse(() => Effect.void),
      );

      yield* restart;
      yield* Queue.offerAll(progress, [30, 60]);
      yield* Queue.offer(downloads, "1.4.0");
      yield* eventually(Effect.map(board.heard, (all) => all.length === 1));
      yield* restart;

      expect(yield* board.heard).toEqual(["Ready 1.4.0"]);
      expect(yield* Ref.get(installs)).toBe(1);
    }),
  );
});

describe("checking from the menu", () => {
  it.effect.each([
    { hears: "up to date", when: "nothing came back", answer: Option.none<FoundUpdate>() },
    { hears: "up to date", when: "nothing is newer", answer: found("1.3.0", false) },
    { hears: "Downloading 1.4.0 0", when: "a version is newer", answer: found("1.4.0") },
  ])("the board hears $hears when $when", ({ answer, hears }) =>
    Effect.gen(function* () {
      const { feed } = yield* fakeFeed([answer]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      yield* updates.checkNow;

      expect(yield* board.heard).toEqual([hears]);
    }),
  );

  it.live("shows the download it found as it goes, then that it's ready", () =>
    Effect.gen(function* () {
      const { feed, downloads, progress } = yield* fakeFeed([found("1.4.0")]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      yield* updates.checkNow;
      yield* Queue.offer(progress, 40);
      yield* eventually(Effect.map(board.heard, (all) => all.length === 2));
      yield* Queue.offer(downloads, "1.4.0");
      yield* eventually(Effect.map(board.heard, (all) => all.length === 3));

      expect(yield* board.heard).toEqual([
        "Downloading 1.4.0 0",
        "Downloading 1.4.0 40",
        "Ready 1.4.0",
      ]);
    }),
  );

  it.live("says why a download it showed failed, and stops showing it", () =>
    Effect.gen(function* () {
      const { feed, errors } = yield* fakeFeed([found("1.4.0")]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      yield* updates.checkNow;
      yield* Queue.offer(errors, "disk full");
      yield* eventually(Effect.map(board.heard, (all) => all.length === 3));

      expect(yield* board.heard).toEqual(["Downloading 1.4.0 0", "Idle", "failed: disk full"]);
      expect(yield* updates.status).toEqual(UpdateStatus.Idle());
    }),
  );

  it.effect("says why a check failed", () =>
    Effect.gen(function* () {
      const { feed } = yield* fakeFeed([new UpdateCheckFailed({ message: "offline" })]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      yield* updates.checkNow;

      expect(yield* board.heard).toEqual(["failed: offline"]);
    }),
  );

  it.live("shows again a version ready to install rather than saying it's up to date", () =>
    Effect.gen(function* () {
      const { feed, downloads } = yield* fakeFeed([found("1.4.0", false)]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, feed);

      yield* Queue.offer(downloads, "1.4.0");
      yield* eventually(Effect.map(board.heard, (all) => all.length === 1));
      yield* updates.checkNow;

      expect(yield* board.heard).toEqual(["Ready 1.4.0", "Ready 1.4.0"]);
    }),
  );

  it.effect("does nothing in a build with no feed", () =>
    Effect.gen(function* () {
      const { feed, checks } = yield* fakeFeed([found("1.4.0")]);
      const board = yield* fakeBoard;

      const updates = yield* start(board.notices, { ...feed, enabled: false });

      yield* updates.checkNow;
      yield* TestClock.adjust("4 hours");

      expect(updates.enabled).toBe(false);
      expect(yield* Ref.get(checks)).toBe(0);
      expect(yield* board.heard).toEqual([]);
    }),
  );
});

describe("a perpetual license whose updates ended", () => {
  const afterEnd = Option.some(UPDATES_ENDED + 1);

  it.effect("a version released after them isn't downloaded, and the board offers a renewal", () =>
    Effect.gen(function* () {
      const { feed, fetched } = yield* fakeFeed([found("1.5.0", true, afterEnd)]);
      const board = yield* fakeBoard;
      const renewed = yield* Ref.make(false);

      const updates = yield* start(board.notices, feed, licenseEnding(renewed));

      yield* TestClock.adjust("0 millis");

      expect(yield* board.heard).toEqual(["Held 1.5.0"]);
      expect(yield* updates.status).toEqual(
        UpdateStatus.Held({ version: "1.5.0", updatesEnded: UPDATES_ENDED }),
      );
      expect(yield* Ref.get(fetched)).toBe(0);
    }),
  );

  it.effect("once renewed, a check downloads the version it held", () =>
    Effect.gen(function* () {
      const { feed, fetched } = yield* fakeFeed([found("1.5.0", true, afterEnd)]);
      const board = yield* fakeBoard;
      const renewed = yield* Ref.make(false);

      const updates = yield* start(board.notices, feed, licenseEnding(renewed));

      yield* TestClock.adjust("0 millis");
      yield* Ref.set(renewed, true);
      yield* updates.checkNow;

      expect(yield* board.heard).toEqual(["Held 1.5.0", "Downloading 1.5.0 0"]);
      expect(yield* Ref.get(fetched)).toBe(1);
    }),
  );

  it.effect("versions released within them, or with no release date, still download", () =>
    Effect.gen(function* () {
      const within = yield* fakeFeed([found("1.4.1", true, Option.some(UPDATES_ENDED))]);
      const undated = yield* fakeFeed([found("1.4.2")]);
      const board = yield* fakeBoard;
      const renewed = yield* Ref.make(false);

      yield* start(board.notices, within.feed, licenseEnding(renewed));
      yield* start(board.notices, undated.feed, licenseEnding(renewed));
      yield* TestClock.adjust("0 millis");

      expect(yield* Ref.get(within.fetched)).toBe(1);
      expect(yield* Ref.get(undated.fetched)).toBe(1);
      expect(yield* board.heard).toEqual([]);
    }),
  );
});
