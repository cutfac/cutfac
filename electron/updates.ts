import { Context, Effect, Layer, Option, Ref, Schedule, Schema, Stream } from "effect";

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
    readonly quitAndInstall: Effect.Effect<void>;
  }
>()("cutfac/desktop/UpdateFeed") {}

export interface UpdatePrompts {
  readonly ready: (version: string) => Effect.Effect<boolean>;
  readonly upToDate: Effect.Effect<void>;
  readonly downloading: (version: string) => Effect.Effect<void>;
  readonly failed: (message: string) => Effect.Effect<void>;
}

/**
 * Downloads new versions in the background and offers a restart once one is ready. Declining
 * installs it the next time the app quits. The free version gets updates as a paid plan does.
 */
export const startUpdates = Effect.fn("updates.start")(function* (prompts: UpdatePrompts) {
  const feed = yield* UpdateFeed;

  if (!feed.enabled) return Updates.of({ enabled: false, checkNow: Effect.void });

  const offered = yield* Ref.make(Option.none<string>());

  const ask = (version: string) =>
    Effect.flatMap(prompts.ready(version), (restart) =>
      restart ? feed.quitAndInstall : Effect.void,
    );

  const offer = (version: string) =>
    Effect.andThen(Ref.set(offered, Option.some(version)), ask(version));

  const offeredAlready = (version: string) =>
    Effect.map(Ref.get(offered), (last) => Option.contains(last, version));

  // Later checks report the same download again; it is offered once unless asked from the menu.
  yield* feed.downloaded.pipe(
    Stream.runForEach((version) =>
      Effect.flatMap(offeredAlready(version), (already) =>
        already
          ? Effect.void
          : Effect.andThen(Ref.set(offered, Option.some(version)), Effect.forkDetach(ask(version))),
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
    Effect.flatMap((found) => {
      if (Option.isNone(found) || !found.value.available) return prompts.upToDate;

      const { version } = found.value;

      return Effect.flatMap(offeredAlready(version), (already) =>
        already ? offer(version) : prompts.downloading(version),
      );
    }),
    Effect.catch((error) => prompts.failed(error.message)),
  );

  return Updates.of({ enabled: true, checkNow });
});

export class Updates extends Context.Service<
  Updates,
  {
    readonly enabled: boolean;
    readonly checkNow: Effect.Effect<void>;
  }
>()("cutfac/desktop/Updates") {
  static readonly layer = (prompts: UpdatePrompts) => Layer.effect(Updates, startUpdates(prompts));
}
