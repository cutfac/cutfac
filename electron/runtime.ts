import * as BunFileSystem from "@effect/platform-bun/BunFileSystem";
import * as BunPath from "@effect/platform-bun/BunPath";
import { Effect, Layer, ManagedRuntime, Predicate } from "effect";
import type { PlatformError } from "effect/PlatformError";

/**
 * The file system and paths for the main process's Effect code. Bun's layers are Node's own
 * implementation, which Electron runs as well.
 */
export const platform = Layer.mergeAll(BunFileSystem.layer, BunPath.layer);

const runtime = ManagedRuntime.make(platform);

/**
 * The error a handler rejects with, as it did before it ran Effect: Node's own for a file system
 * call, else a plain `Error`. Electron prefixes the message with the error's name, which the board
 * shows, so a tagged error would read differently.
 */
const plainError = (error: PlatformError | { readonly message: string }) =>
  Predicate.isTagged(error, "PlatformError") && error.cause instanceof Error
    ? error.cause
    : new Error(error.message);

/** Runs `effect` from one of Electron's callbacks, which waits on a promise. */
export const runInMain = <A, E extends PlatformError | { readonly message: string }>(
  effect: Effect.Effect<A, E, Layer.Success<typeof platform>>,
) => runtime.runPromise(Effect.mapError(effect, plainError));
