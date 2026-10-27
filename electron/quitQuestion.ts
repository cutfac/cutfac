import { Effect, Fiber, Option, Ref, SynchronizedRef } from "effect";

/** How many videos have an agent or a render at work, as the board last said. */
export const busyWork = Ref.makeUnsafe(0);

export interface QuitQuestion {
  /** Whether quitting now waits on the person: work goes on, and nothing has settled it. */
  readonly mustAsk: Effect.Effect<boolean>;
  /** Asks, or waits on the question already up; true to quit anyway, which settles it. */
  readonly ask: Effect.Effect<boolean>;
  /** Something other than the person quits the app, such as a signal or the Mac shutting down. */
  readonly settle: Effect.Effect<void>;
}

/** Asking before quitting while `busy` work goes on, with `confirm` asking the person. */
export const quitQuestion = (busy: Effect.Effect<number>, confirm: Effect.Effect<boolean>) =>
  Effect.gen(function* () {
    const settled = yield* Ref.make(false);
    const asking = yield* SynchronizedRef.make(Option.none<Fiber.Fiber<boolean>>());

    const ask = SynchronizedRef.modifyEffect(asking, (current) =>
      Option.match(current, {
        onSome: (fiber) => Effect.succeed([fiber, current] as const),
        onNone: () =>
          confirm.pipe(
            Effect.tap((quit) => (quit ? Ref.set(settled, true) : Effect.void)),
            Effect.ensuring(SynchronizedRef.set(asking, Option.none())),
            Effect.forkDetach,
            Effect.map((fiber) => [fiber, Option.some(fiber)] as const),
          ),
      }),
    ).pipe(Effect.flatMap(Fiber.join));

    return {
      mustAsk: Effect.zipWith(Ref.get(settled), busy, (done, work) => !done && work > 0),
      ask,
      settle: Ref.set(settled, true),
    } satisfies QuitQuestion;
  });
