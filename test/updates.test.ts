import { describe, expect } from "bun:test";

import { Effect, Option, Queue, Ref, Stream } from "effect";
import { TestClock } from "effect/testing";

import {
  startUpdates,
  UpdateCheckFailed,
  UpdateFeed,
  type FoundUpdate,
  type UpdatePrompts,
} from "../electron/updates.ts";
import { eventually, it } from "./effect.ts";

const fakeFeed = Effect.fnUntraced(function* (
  answers: ReadonlyArray<Option.Option<FoundUpdate> | UpdateCheckFailed>,
) {
  const checks = yield* Ref.make(0);
  const installs = yield* Ref.make(0);
  const downloads = yield* Queue.unbounded<string>();

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
    downloaded: Stream.fromQueue(downloads),
    quitAndInstall: Ref.update(installs, (n) => n + 1),
  });

  return { feed, checks, installs, downloads };
});

const fakePrompts = Effect.fnUntraced(function* (restart: boolean) {
  const said = yield* Ref.make<ReadonlyArray<string>>([]);
  const say = (line: string) => Ref.update(said, (all) => [...all, line]);

  const prompts: UpdatePrompts = {
    ready: (version) => Effect.as(say(`ready ${version}`), restart),
    upToDate: say("up to date"),
    downloading: (version) => say(`downloading ${version}`),
    failed: (message) => say(`failed: ${message}`),
  };

  return { prompts, said };
});

const found = (version: string, available = true) => Option.some({ available, version });

describe("updating in the background", () => {
  it.effect("checks at launch and every four hours, a failed check waiting for the next", () =>
    Effect.gen(function* () {
      const { feed, checks } = yield* fakeFeed([
        new UpdateCheckFailed({ message: "offline" }),
        Option.none(),
      ]);

      const { prompts, said } = yield* fakePrompts(false);

      yield* startUpdates(prompts).pipe(Effect.provideService(UpdateFeed, feed));
      yield* TestClock.adjust("0 millis");

      expect(yield* Ref.get(checks)).toBe(1);

      yield* TestClock.adjust("4 hours");
      yield* TestClock.adjust("4 hours");

      expect(yield* Ref.get(checks)).toBe(3);
      expect(yield* Ref.get(said)).toEqual([]);
    }),
  );

  it.live("offers a downloaded version once, however often it is reported, and restarts", () =>
    Effect.gen(function* () {
      const { feed, installs, downloads } = yield* fakeFeed([Option.none()]);
      const { prompts, said } = yield* fakePrompts(true);

      yield* startUpdates(prompts).pipe(Effect.provideService(UpdateFeed, feed));
      yield* Queue.offerAll(downloads, ["1.4.0", "1.4.0"]);
      yield* eventually(Effect.map(Ref.get(installs), (n) => n === 1));
      yield* Queue.offer(downloads, "1.4.0");
      yield* Effect.sleep("20 millis");

      expect(yield* Ref.get(said)).toEqual(["ready 1.4.0"]);
      expect(yield* Ref.get(installs)).toBe(1);
    }),
  );
});

describe("checking from the menu", () => {
  it.effect.each([
    { says: "up to date", when: "nothing came back", answer: Option.none<FoundUpdate>() },
    { says: "up to date", when: "nothing is newer", answer: found("1.3.0", false) },
    { says: "downloading 1.4.0", when: "a version is newer", answer: found("1.4.0") },
  ])("says $says when $when", ({ answer, says }) =>
    Effect.gen(function* () {
      const { feed } = yield* fakeFeed([answer]);
      const { prompts, said } = yield* fakePrompts(false);
      const updates = yield* startUpdates(prompts).pipe(Effect.provideService(UpdateFeed, feed));

      yield* updates.checkNow;

      expect(yield* Ref.get(said)).toEqual([says]);
    }),
  );

  it.effect("says why a check failed", () =>
    Effect.gen(function* () {
      const { feed } = yield* fakeFeed([new UpdateCheckFailed({ message: "offline" })]);

      const { prompts, said } = yield* fakePrompts(false);
      const updates = yield* startUpdates(prompts).pipe(Effect.provideService(UpdateFeed, feed));

      yield* updates.checkNow;

      expect(yield* Ref.get(said)).toEqual(["failed: offline"]);
    }),
  );

  it.live("offers again a version already downloaded and declined", () =>
    Effect.gen(function* () {
      const { feed, downloads } = yield* fakeFeed([found("1.4.0")]);
      const { prompts, said } = yield* fakePrompts(false);
      const updates = yield* startUpdates(prompts).pipe(Effect.provideService(UpdateFeed, feed));

      yield* Queue.offer(downloads, "1.4.0");
      yield* eventually(Effect.map(Ref.get(said), (all) => all.length === 1));
      yield* updates.checkNow;

      expect(yield* Ref.get(said)).toEqual(["ready 1.4.0", "ready 1.4.0"]);
    }),
  );

  it.effect("does nothing in a build with no feed", () =>
    Effect.gen(function* () {
      const { feed, checks } = yield* fakeFeed([found("1.4.0")]);
      const { prompts, said } = yield* fakePrompts(false);

      const updates = yield* startUpdates(prompts).pipe(
        Effect.provideService(UpdateFeed, { ...feed, enabled: false }),
      );

      yield* updates.checkNow;
      yield* TestClock.adjust("4 hours");

      expect(updates.enabled).toBe(false);
      expect(yield* Ref.get(checks)).toBe(0);
      expect(yield* Ref.get(said)).toEqual([]);
    }),
  );
});
