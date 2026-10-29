import { Effect, Match, Option, Queue, Ref, Stream } from "effect";
import { app, BrowserWindow } from "electron";

import type { FakeUpdate } from "../web/src/desktop.ts";
import { UpdateCheckFailed, UpdateFeed } from "./updates.ts";

/** The version the dev build pretends to update to. */
const FAKE_VERSION = "9.9.9";

const fake = Effect.runSync(
  Effect.all({
    next: Ref.make<FakeUpdate>("none"),
    downloaded: Queue.unbounded<string>(),
    progress: Queue.unbounded<number>(),
  }),
);

/** A download that takes a few seconds, as a real one does on a quick connection. */
const download = Effect.gen(function* () {
  for (const percent of [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]) {
    yield* Queue.offer(fake.progress, percent);
    yield* Effect.sleep("300 millis");
  }

  yield* Queue.offer(fake.downloaded, FAKE_VERSION);
});

/**
 * The dev build has no update feed, so its Dev Panel plays one out in its place: what the next
 * check finds, a download as it goes, and a restart that quits as the installer would, but stays
 * closed.
 */
export const devUpdateFeed = UpdateFeed.of({
  enabled: true,
  check: Effect.flatMap(Ref.get(fake.next), (next) =>
    Match.value(next).pipe(
      Match.when("found", () =>
        Effect.succeedSome({ available: true, version: FAKE_VERSION, releasedAt: Option.none() }),
      ),
      Match.when("fails", () =>
        Effect.fail(new UpdateCheckFailed({ message: "The update server didn't answer (faked)." })),
      ),
      Match.orElse(() =>
        Effect.succeedSome({
          available: false,
          version: app.getVersion(),
          releasedAt: Option.none(),
        }),
      ),
    ),
  ),
  download: Effect.asVoid(Effect.forkDetach(download)),
  downloaded: Stream.fromQueue(fake.downloaded),
  progress: Stream.fromQueue(fake.progress),
  errors: Stream.empty,
  // As the installer does: the windows close first, then the app quits.
  quitAndInstall: Effect.sync(() => {
    for (const window of BrowserWindow.getAllWindows()) window.close();

    app.quit();
  }),
});

/** What the next check finds; the checks after it find nothing again. */
export const fakeNextCheck = (next: FakeUpdate) => Ref.set(fake.next, next);

/** A version downloaded in the background, ready to install. */
export const fakeDownloaded = Queue.offer(fake.downloaded, FAKE_VERSION);
