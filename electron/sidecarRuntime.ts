import { Effect, Option, Queue, Ref } from "effect";

import { AgentFixes } from "./agents.ts";
import { AppState } from "./appState.ts";
import { forkInMain, installInfo, runInMain, runNow } from "./runtime.ts";
import { boardDirOf } from "./sidecar.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

export const boardDir = () => boardDirOf(installInfo());

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

/** Kills every fix still running, as the app quits. */
export const stopFixes = () => runNow(Effect.flatMap(AgentFixes, (agents) => agents.stopAll));
