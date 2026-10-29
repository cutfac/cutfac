import { Context, Data, Effect, Layer, Option, Ref, Schedule, Schema, Stream } from "effect";

import { License } from "./license.ts";

const CHECK_EVERY = "4 hours";

export class UpdateCheckFailed extends Schema.TaggedError<UpdateCheckFailed>()(
  "UpdateCheckFailed",
  { message: Schema.String },
) {}

export interface FoundUpdate {
  readonly available: boolean;
  readonly version: string;
  /** When the version was released, which a perpetual license's updates are held to. */
  readonly releasedAt: Option.Option<number>;
}

export class UpdateFeed extends Context.Service<
  UpdateFeed,
  {
    readonly enabled: boolean;
    /** Finds the newest version without downloading it. */
    readonly check: Effect.Effect<Option.Option<FoundUpdate>, UpdateCheckFailed>;
    /** Downloads the version the last check found, in the background. */
    readonly download: Effect.Effect<void>;
    readonly downloaded: Stream.Stream<string>;
    /** How far the download under way is, in percent. */
    readonly progress: Stream.Stream<number>;
    /** Why a check or a download failed. */
    readonly errors: Stream.Stream<string>;
    readonly quitAndInstall: Effect.Effect<void>;
  }
>()("cutfac/desktop/UpdateFeed") {}

/**
 * What the board shows about updates: nothing, a download the user asked for, a version ready to
 * install with a restart, or one released after the license's updates ended, which a renewal gets.
 */
export type UpdateStatus = Data.TaggedEnum<{
  Idle: {};
  Downloading: { readonly version: string; readonly percent: number };
  Ready: { readonly version: string };
  Held: { readonly version: string; readonly updatesEnded: number };
}>;

export const UpdateStatus = Data.taggedEnum<UpdateStatus>();

/** How the board hears about updates, so none of it interrupts the user. */
export interface UpdateNotices {
  readonly status: (status: UpdateStatus) => Effect.Effect<void>;
  /** A check the user asked for found nothing newer. */
  readonly upToDate: Effect.Effect<void>;
  readonly failed: (message: string) => Effect.Effect<void>;
}

/**
 * Downloads new versions in the background and has the board offer a restart once one is ready;
 * left alone, it installs the next time the app quits. A check from the menu shows its download as
 * it goes. The free version gets updates as a paid plan does, but a version released after a
 * perpetual license's updates ended isn't downloaded, since it would run as the free version: the
 * board offers a renewal instead.
 */
export const startUpdates = Effect.fn("updates.start")(function* (notices: UpdateNotices) {
  const feed = yield* UpdateFeed;
  const license = yield* License;

  if (!feed.enabled) {
    return Updates.of({
      enabled: false,
      checkNow: Effect.void,
      status: Effect.succeed(UpdateStatus.Idle()),
      install: Effect.succeedNone,
    });
  }

  const status = yield* Ref.make<UpdateStatus>(UpdateStatus.Idle());

  const publish = (next: UpdateStatus) =>
    Effect.andThen(Ref.set(status, next), notices.status(next));

  const downloading = Effect.map(
    Ref.get(status),
    Option.liftPredicate(UpdateStatus.$is("Downloading")),
  );

  yield* feed.downloaded.pipe(
    Stream.runForEach((version) => publish(UpdateStatus.Ready({ version }))),
    Effect.forkScoped,
  );

  yield* feed.progress.pipe(
    Stream.runForEach((percent) =>
      Effect.flatMap(downloading, (now) =>
        Option.match(now, {
          onNone: () => Effect.void,
          onSome: ({ version }) => publish(UpdateStatus.Downloading({ version, percent })),
        }),
      ),
    ),
    Effect.forkScoped,
  );

  yield* feed.errors.pipe(
    Stream.runForEach((message) =>
      Effect.flatMap(downloading, (now) =>
        Option.isSome(now)
          ? Effect.andThen(publish(UpdateStatus.Idle()), notices.failed(message))
          : Effect.void,
      ),
    ),
    Effect.forkScoped,
  );

  /** A version ready or on its way, which the sidebar shows already. */
  const underWay = Effect.map(
    Ref.get(status),
    (now) => UpdateStatus.$is("Downloading")(now) || UpdateStatus.$is("Ready")(now),
  );

  /**
   * Takes `found` if the license covers it, its download shown when the user asked; otherwise holds
   * it for a renewal. A version with no release date is taken.
   */
  const take = Effect.fnUntraced(function* (found: FoundUpdate, shown: boolean) {
    const covered = yield* Option.match(found.releasedAt, {
      onNone: () => Effect.succeed(true),
      onSome: license.covers,
    });

    if (!covered) {
      const updatesEnded = Option.getOrElse(yield* license.updatesEnd, () => 0);

      return yield* publish(UpdateStatus.Held({ version: found.version, updatesEnded }));
    }

    if (shown) yield* publish(UpdateStatus.Downloading({ version: found.version, percent: 0 }));
    // A renewal came through since the version was held.
    else if (UpdateStatus.$is("Held")(yield* Ref.get(status))) yield* publish(UpdateStatus.Idle());

    yield* feed.download;
  });

  const inBackground = feed.check.pipe(
    Effect.flatMap((found) =>
      Effect.gen(function* () {
        if ((yield* underWay) || Option.isNone(found) || !found.value.available) return;

        yield* take(found.value, false);
      }),
    ),
  );

  yield* inBackground.pipe(
    Effect.ignore({ log: "Warn", message: "Checking for updates failed" }),
    Effect.repeat(Schedule.spaced(CHECK_EVERY)),
    Effect.forkScoped,
  );

  const checkNow = feed.check.pipe(
    Effect.flatMap((found) =>
      Effect.gen(function* () {
        if (yield* underWay) return yield* notices.status(yield* Ref.get(status));

        if (Option.isNone(found) || !found.value.available) return yield* notices.upToDate;

        yield* take(found.value, true);
      }),
    ),
    Effect.catch((error) => notices.failed(error.message)),
  );

  const install = Effect.map(Ref.get(status), (now) =>
    UpdateStatus.$is("Ready")(now) ? Option.some(feed.quitAndInstall) : Option.none(),
  );

  return Updates.of({ enabled: true, checkNow, status: Ref.get(status), install });
});

export class Updates extends Context.Service<
  Updates,
  {
    readonly enabled: boolean;
    readonly checkNow: Effect.Effect<void>;
    readonly status: Effect.Effect<UpdateStatus>;
    /**
     * What installs the version that is ready and opens the app again, once one is: the last step
     * of a restart, after the app has stopped its work.
     */
    readonly install: Effect.Effect<Option.Option<Effect.Effect<void>>>;
  }
>()("cutfac/desktop/Updates") {
  static readonly layer = (notices: UpdateNotices) => Layer.effect(Updates, startUpdates(notices));
}
