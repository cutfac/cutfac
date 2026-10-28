import { Effect, type ManagedRuntime } from "effect";

/**
 * The app's way out: once `save` is done, closes `runtime`, so each of its services stops what it
 * opened, the workspace server, agent fixes, watchers and timers among them. Run from one of the
 * runtime's own fibers, which closing the runtime leaves to finish.
 */
export const shutDown = <R, ER, E>(
  runtime: ManagedRuntime.ManagedRuntime<R, ER>,
  save: Effect.Effect<void, E, R>,
) => Effect.andThen(Effect.exit(save), runtime.disposeEffect);
