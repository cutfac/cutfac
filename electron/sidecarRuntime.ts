import { Effect, Option, Queue, Ref } from "effect";

import { AppState } from "./appState.ts";
import { forkInMain, installInfo, runInMain, runNow } from "./runtime.ts";
import { boardDirOf, runCli as runCommand, ServerEnv } from "./sidecar.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

export const boardDir = () => boardDirOf(installInfo());

/** The environment the server and the commands it runs get, read once. */
export const resolveServerEnv = () => runInMain(ServerEnv);

/** Runs a server command that needs no workspace, such as `agents --json`. */
export const runCli = (args: ReadonlyArray<string>) => runInMain(runCommand(args));

/** The url of the server on `workspace`, started unless it runs there; undefined if quitting. */
export const serveWorkspace = (workspace: string) =>
  runInMain(
    Effect.flatMap(WorkspaceServer, (server) =>
      Effect.map(server.serve(workspace), (served) =>
        Option.getOrUndefined(Option.map(served, (sidecar) => sidecar.url)),
      ),
    ),
  );

export const stopWorkspaceServer = () =>
  runInMain(Effect.flatMap(WorkspaceServer, (server) => server.stop));

/** Synchronous SIGKILL for the process-exit hook. */
export const killWorkspaceServer = () =>
  runNow(Effect.flatMap(WorkspaceServer, (server) => server.kill));

/** Calls `handle` with why, each time the server stops on its own. */
export const watchServerCrashes = (handle: (message: string) => void) =>
  forkInMain(
    Effect.flatMap(WorkspaceServer, (server) =>
      Queue.take(server.crashes).pipe(
        Effect.flatMap((message) => Effect.sync(() => handle(message))),
        Effect.forever,
      ),
    ),
  );

/** The app is quitting: a server that finishes starting now is stopped, not served. */
export const markQuitting = () =>
  forkInMain(Effect.flatMap(AppState, ({ quitting }) => Ref.set(quitting, true)));
