import { BunChildProcessSpawner } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime, Option } from "effect";
import { FetchHttpClient } from "effect/http";
import { app } from "electron";

import { platform } from "./platform.ts";
import { appLog, memoMap } from "./runtime.ts";
import {
  boardDirOf,
  Install,
  runCli as runCommand,
  ServerEnv,
  startSidecar as start,
  type InstallInfo,
} from "./sidecar.ts";

/** Where the app runs from and what it was started with, as Electron reports them. */
const install = (): InstallInfo => ({
  packaged: app.isPackaged,
  appPath: app.getAppPath(),
  resourcesPath: process.resourcesPath,
  logsPath: app.getPath("logs"),
  homePath: app.getPath("home"),
  launchEnv: process.env,
});

const runtime = ManagedRuntime.make(
  Layer.mergeAll(ServerEnv.layer, BunChildProcessSpawner.layer, FetchHttpClient.layer, appLog).pipe(
    Layer.provideMerge(Layer.mergeAll(Layer.sync(Install, install), platform)),
  ),
  { memoMap },
);

/** The built board, which the server serves and the first launch loads before there is one. */
export const boardDir = () => boardDirOf(install());

/** The environment the server and the commands it runs get, read once. */
export const resolveServerEnv = () => runtime.runPromise(ServerEnv);

/** Runs a server command that needs no workspace, such as `agents --json`. */
export const runCli = (args: ReadonlyArray<string>) => runtime.runPromise(runCommand(args));

/** The local server as the app's main process uses it, outside Effect. */
export interface Sidecar {
  url: string;
  port: number;
  /** SIGTERM, then SIGKILL after a grace period. Resolves once the process is gone. */
  stop: () => Promise<void>;
  /** Synchronous SIGKILL for the process-exit hook. */
  kill: () => void;
}

export interface SidecarOptions {
  workspace: string;
  /** A port the server must take, as the dev runner's proxy expects; else the last one, if free. */
  port: { fixed: number } | { last: number | undefined };
  /** Called with an explanation and the output tail if the server dies without `stop()`. */
  onCrash: (message: string) => void;
  /** Restart the server in place when its source changes, if it runs from source. */
  watch: boolean;
}

/** Sets the workspace up if needed, starts the server on it and resolves once it is healthy. */
export async function startSidecar({
  port,
  onCrash,
  ...options
}: SidecarOptions): Promise<Sidecar> {
  const sidecar = await runtime.runPromise(
    start({
      ...options,
      port: "fixed" in port ? port : { last: Option.fromNullishOr(port.last) },
      onCrash: (message) => Effect.sync(() => onCrash(message)),
    }),
  );

  return {
    url: sidecar.url,
    port: sidecar.port,
    stop: () => runtime.runPromise(sidecar.stop),
    kill: () => runtime.runSync(sidecar.kill),
  };
}
