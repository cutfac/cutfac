import { Effect } from "effect";

import { AgentFixes } from "./agents.ts";
import { installInfo, runNow } from "./runtime.ts";
import { boardDirOf } from "./sidecar.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

export const boardDir = () => boardDirOf(installInfo());

/** Synchronous SIGKILL for the process-exit hook. */
export const killWorkspaceServer = () =>
  runNow(Effect.flatMap(WorkspaceServer, (server) => server.kill));

/** Kills every fix still running, as the app quits. */
export const stopFixes = () => runNow(Effect.flatMap(AgentFixes, (agents) => agents.stopAll));
