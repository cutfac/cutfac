import { Schema } from "effect";

import { AgentName, request, send } from "./api.ts";

/** How much a run from the board may do: as the user's own settings say, or one of Cutfac's three. */
export const PermissionMode = Schema.Literals(["follow", "edit", "auto", "full"]);

export type PermissionMode = typeof PermissionMode.Type;

/**
 * What a run may do in the end: ask the board before it acts, edit in the workspace, more as a
 * reviewer agrees, anything, or less.
 */
export const Access = Schema.Literals(["asks", "edit", "auto", "full", "unasked", "limited"]);

export type Access = typeof Access.Type;

/** How an agent's runs may act; see src/core/agentPermissions.ts. */
export const PermissionView = Schema.Struct({
  agent: AgentName,
  mode: PermissionMode,
  /** What following the user's own settings comes to. */
  follows: Access,
  /** The setting that decides it, as the user wrote it; none when they set none. */
  setting: Schema.optionalKey(Schema.String),
});

export type PermissionView = typeof PermissionView.Type;

export interface PermissionChoice {
  agent: AgentName;
  mode: PermissionMode;
}

/** The board's calls for how each agent's runs may act; see src/server/agents.ts. */
export const permissionsApi = {
  list: () => request(Schema.Array(PermissionView), "/api/agent-permissions"),
  set: (choice: PermissionChoice) => send(PermissionView, "POST", "/api/agent-permissions", choice),
};
