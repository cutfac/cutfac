// @effect-diagnostics strictEffectProvide:off
import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect, Exit, Predicate, Runtime } from "effect";

/**
 * Runs a script's program, whose success is its exit code. Ctrl+C interrupts the program so its
 * cleanup runs, and the script exits 130.
 */
export const runScript = <E extends { readonly message: string }>(
  name: string,
  program: Effect.Effect<number, E, BunServices.BunServices>,
) =>
  BunRuntime.runMain(
    program.pipe(
      Effect.catch((error) => Effect.as(Console.error(`[${name}] ${error.message}`), 1)),
      Effect.provide(BunServices.layer),
    ),
    {
      teardown: (exit, onExit) =>
        Exit.isSuccess(exit) && Predicate.isNumber(exit.value)
          ? onExit(exit.value)
          : Runtime.defaultTeardown(exit, onExit),
    },
  );
