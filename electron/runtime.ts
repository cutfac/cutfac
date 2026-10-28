import path from "node:path";

import { Effect, Layer, ManagedRuntime, Option, Predicate, Ref } from "effect";
import { FetchHttpClient } from "effect/http";
import type { PlatformError } from "effect/PlatformError";
import { app } from "electron";

import { AppData } from "../src/core/appData.ts";
import { LogDir, logToFile } from "../src/core/logFile.ts";
import { errorReports } from "../src/errorReports.ts";
import { AgentFixes } from "./agents.ts";
import { AppState } from "./appState.ts";
import { devLaunchOf, type DevLaunch } from "./devEnv.ts";
import { FirstWorkspace } from "./firstWorkspace.ts";
import { LICENSE_CHANGE_CHANNEL } from "./ipc.ts";
import { License } from "./license.ts";
import { MESSAGES } from "./messages.ts";
import { platform } from "./platform.ts";
import { licenseSettings, Settings } from "./settings.ts";
import { shutDown } from "./shutdown.ts";
import { Install, ServerEnv, type InstallInfo } from "./sidecar.ts";
import { SystemAccess } from "./systemAccess.ts";
import { updateFeed, updatePrompts } from "./updateFeed.ts";
import { Updates } from "./updates.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

// The packaged app ignores what the dev runner launches with, so another program can't open it on a
// page of its choosing.
export const devLaunch = app.isPackaged ? Option.none<DevLaunch>() : Effect.runSync(devLaunchOf);

export const installInfo = (): InstallInfo => ({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  logsPath: app.getPath("logs"),
  homePath: app.getPath("home"),
  launchEnv: process.env,
  devPort: Option.map(devLaunch, ({ serverPort }) => serverPort),
});

const appData = Layer.sync(AppData, () => Option.some(app.getPath("userData")));

const appReports = errorReports("app").pipe(
  Layer.provide([appData, FetchHttpClient.layer, platform]),
);

export const appLog = logToFile("app").pipe(
  Layer.provide([Layer.sync(LogDir, () => Option.some(app.getPath("logs"))), appReports, platform]),
);

const settings = Layer.unwrap(
  Effect.sync(() =>
    Settings.layer({
      dir: app.getPath("userData"),
      defaultLibrary: path.join(app.getPath("videos"), app.getName()),
    }),
  ),
);

export const appState = Effect.runSync(AppState.make);

export const readNow = <A>(ref: Ref.Ref<A>) => Effect.runSync(Ref.get(ref));

export const boardWindow = () => Option.getOrUndefined(readNow(appState.window));

const base = Layer.mergeAll(
  platform,
  Layer.sync(Install, installInfo),
  appData,
  Layer.succeed(AppState, appState),
);

const services = Layer.mergeAll(
  settings,
  ServerEnv.layer,
  FetchHttpClient.layer,
  appLog,
  updateFeed,
).pipe(Layer.provideMerge(base));

const license = Layer.unwrap(
  Effect.sync(() =>
    app.isPackaged
      ? License.layer(
          Effect.sync(() => boardWindow()?.webContents.send(LICENSE_CHANGE_CHANNEL)),
        ).pipe(Layer.provide(licenseSettings))
      : License.unavailable,
  ),
);

const updates = Updates.layer(updatePrompts(() => MESSAGES[readNow(appState.locale)], boardWindow));

export const appServices = Layer.mergeAll(
  FirstWorkspace.layer,
  AgentFixes.layer,
  SystemAccess.layer,
  license,
  updates,
).pipe(Layer.provideMerge(WorkspaceServer.layer), Layer.provideMerge(services));

export type AppServices = Layer.Success<typeof appServices>;

const runtime = ManagedRuntime.make(appServices);

// Electron prefixes the message with the error's name, which the board shows.
const plainError = (error: PlatformError | { readonly message: string }) =>
  Predicate.isTagged(error, "PlatformError") && error.cause instanceof Error
    ? error.cause
    : new Error(error.message);

/** Runs `effect` from one of Electron's callbacks, which waits on a promise. */
export const runInMain = <A, E extends PlatformError | { readonly message: string }>(
  effect: Effect.Effect<A, E, AppServices>,
) => runtime.runPromise(Effect.mapError(effect, plainError));

export const forkInMain = <A, E>(effect: Effect.Effect<A, E, AppServices>) =>
  void runtime.runFork(effect);

export const runNow = (effect: Effect.Effect<void, never, AppServices>) => {
  if (runtime.cachedContext !== undefined) runtime.runSync(effect);
};

export const shutDownMain = <E>(save: Effect.Effect<void, E, AppServices>) =>
  shutDown(runtime, save);
