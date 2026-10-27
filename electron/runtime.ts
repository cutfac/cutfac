import { Effect, Layer, ManagedRuntime, Option, Predicate } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { app } from "electron";

import { LogDir, logToFile } from "../src/core/logFile.ts";
import { platform } from "./platform.ts";

/** The app's own log, in Electron's logs folder: `~/Library/Logs/Cutfac`, or `Cutfac Dev`. */
export const appLog = logToFile("app").pipe(
  Layer.provide([Layer.sync(LogDir, () => Option.some(app.getPath("logs"))), platform]),
);

/** Shared by the main process's runtimes, so they build the app's log once between them. */
export const memoMap = Layer.makeMemoMapUnsafe();

const runtime = ManagedRuntime.make(Layer.merge(platform, appLog), { memoMap });

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
