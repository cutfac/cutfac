import { Effect, Fiber, Option, Ref, SynchronizedRef } from "effect";

export const busyWork = Ref.makeUnsafe(0);

export interface QuitQuestion {
  readonly mustAsk: Effect.Effect<boolean>;
  readonly ask: Effect.Effect<boolean>;
  readonly settle: Effect.Effect<void>;
}

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
