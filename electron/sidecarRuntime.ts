import { Effect, Option } from "effect";

import { installInfo, runInMain, runNow } from "./runtime.ts";
import { boardDirOf, runCli as runCommand, ServerEnv, startSidecar as start } from "./sidecar.ts";

export const boardDir = () => boardDirOf(installInfo());

/** The environment the server and the commands it runs get, read once. */
export const resolveServerEnv = () => runInMain(ServerEnv);

/** Runs a server command that needs no workspace, such as `agents --json`. */
export const runCli = (args: ReadonlyArray<string>) => runInMain(runCommand(args));

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
  const sidecar = await runInMain(
    start({
      ...options,
      port: "fixed" in port ? port : { last: Option.fromNullishOr(port.last) },
      onCrash: (message) => Effect.sync(() => onCrash(message)),
    }),
  );

  return {
    url: sidecar.url,
    port: sidecar.port,
    stop: () => runInMain(sidecar.stop),
    kill: () => runNow(sidecar.kill),
  };
}
