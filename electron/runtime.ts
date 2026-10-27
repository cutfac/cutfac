import path from "node:path";

import { Effect, Layer, ManagedRuntime, Option, Predicate } from "effect";
import { FetchHttpClient } from "effect/http";
import type { PlatformError } from "effect/PlatformError";
import { app } from "electron";

import { AppData } from "../src/core/appData.ts";
import { LogDir, logToFile } from "../src/core/logFile.ts";
import { errorReports } from "../src/errorReports.ts";
import { AgentFixes } from "./agents.ts";
import { AppState } from "./appState.ts";
import { platform } from "./platform.ts";
import { Settings } from "./settings.ts";
import { Install, ServerEnv, type InstallInfo } from "./sidecar.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

export const installInfo = (): InstallInfo => ({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  logsPath: app.getPath("logs"),
  homePath: app.getPath("home"),
  launchEnv: process.env,
  devPort:
    !app.isPackaged && process.env.CUTFAC_DEV_URL
      ? Option.some(Number.parseInt(process.env.CUTFAC_PORT ?? "4317", 10))
      : Option.none(),
});

const appData = Layer.sync(AppData, () => Option.some(app.getPath("userData")));

const appReports = errorReports("app").pipe(
  Layer.provide([appData, FetchHttpClient.layer, platform]),
);

/** `~/Library/Logs/Cutfac`, or `Cutfac Dev`, with error reports when the person allows them. */
export const appLog = logToFile("app").pipe(
  Layer.provide([Layer.sync(LogDir, () => Option.some(app.getPath("logs"))), appReports, platform]),
);

/** New workspaces go in `~/Movies/Cutfac` unless the user chose a folder, as video apps do. */
const settings = Layer.unwrap(
  Effect.sync(() =>
    Settings.layer({
      dir: app.getPath("userData"),
      defaultLibrary: path.join(app.getPath("videos"), app.getName()),
    }),
  ),
);

const base = Layer.mergeAll(platform, Layer.sync(Install, installInfo), appData, AppState.layer);

const services = Layer.mergeAll(settings, ServerEnv.layer, FetchHttpClient.layer, appLog).pipe(
  Layer.provideMerge(base),
);

export const appServices = Layer.mergeAll(WorkspaceServer.layer, AgentFixes.layer).pipe(
  Layer.provideMerge(services),
);

export type AppServices = Layer.Success<typeof appServices>;

/** Shared by the main process's runtimes, so they build the app's services once between them. */
export const memoMap = Layer.makeMemoMapUnsafe();

const runtime = ManagedRuntime.make(appServices, { memoMap });

/**
 * The error a handler rejects with: Node's own for a file system call, else a plain `Error`.
 * Electron prefixes the message with the error's name, which the board shows.
 */
const plainError = (error: PlatformError | { readonly message: string }) =>
  Predicate.isTagged(error, "PlatformError") && error.cause instanceof Error
    ? error.cause
    : new Error(error.message);

/** Runs `effect` from one of Electron's callbacks, which waits on a promise. */
export const runInMain = <A, E extends PlatformError | { readonly message: string }>(
  effect: Effect.Effect<A, E, AppServices>,
) => runtime.runPromise(Effect.mapError(effect, plainError));

/** Starts `effect` from one of Electron's callbacks, which doesn't wait on it. */
export const forkInMain = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  void runtime.runFork(effect);

/**
 * Runs `effect` at once, for Electron's process-exit hook, which can't wait; nothing before the
 * app's services exist, as there is nothing of theirs to clean up.
 */
export const runNow = (effect: Effect.Effect<void, never, AppServices>) => {
  if (runtime.cachedContext !== undefined) runtime.runSync(effect);
};
