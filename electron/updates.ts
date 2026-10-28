import { Context, Data, Effect, Layer, Option, Ref, Schedule, Schema, Stream } from "effect";

const CHECK_EVERY = "4 hours";

export class UpdateCheckFailed extends Schema.TaggedError<UpdateCheckFailed>()(
  "UpdateCheckFailed",
  { message: Schema.String },
) {}

export interface FoundUpdate {
  readonly available: boolean;
  readonly version: string;
}

export class UpdateFeed extends Context.Service<
  UpdateFeed,
  {
    readonly enabled: boolean;
    readonly check: Effect.Effect<Option.Option<FoundUpdate>, UpdateCheckFailed>;
    readonly downloaded: Stream.Stream<string>;
    /** How far the download under way is, in percent. */
    readonly progress: Stream.Stream<number>;
    /** Why a check or a download failed. */
    readonly errors: Stream.Stream<string>;
    readonly quitAndInstall: Effect.Effect<void>;
  }
>()("cutfac/desktop/UpdateFeed") {}

/**
 * What the board shows about updates: nothing, a download the user asked for, or a version ready to
 * install with a restart.
 */
export type UpdateStatus = Data.TaggedEnum<{
  Idle: {};
  Downloading: { readonly version: string; readonly percent: number };
  Ready: { readonly version: string };
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
 * it goes. The free version gets updates as a paid plan does.
 */
export const startUpdates = Effect.fn("updates.start")(function* (notices: UpdateNotices) {
  const feed = yield* UpdateFeed;

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

  yield* feed.check.pipe(
    Effect.ignore({ log: "Warn", message: "Checking for updates failed" }),
    Effect.repeat(Schedule.spaced(CHECK_EVERY)),
    Effect.forkScoped,
  );

  const checkNow = feed.check.pipe(
    Effect.flatMap((found) =>
      Effect.gen(function* () {
        const now = yield* Ref.get(status);

        // One ready or on its way is in the sidebar already.
        if (!UpdateStatus.$is("Idle")(now)) return yield* notices.status(now);

        if (Option.isNone(found) || !found.value.available) return yield* notices.upToDate;

        yield* publish(UpdateStatus.Downloading({ version: found.value.version, percent: 0 }));
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
