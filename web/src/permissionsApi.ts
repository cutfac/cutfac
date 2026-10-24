import { type AgentName, request, send } from "./api.ts";

/** How much a run from the board may do: as the user's own settings say, or one of Cutfac's three. */
export type PermissionMode = "follow" | "edit" | "auto" | "full";

/** What a run may do in the end: edit in the workspace, more as a reviewer agrees, anything, or less. */
export type Access = "edit" | "auto" | "full" | "limited";

/** How an agent's runs may act; see src/core/agentPermissions.ts. */
export interface PermissionView {
  agent: AgentName;
  mode: PermissionMode;
  /** What following the user's own settings comes to. */
  follows: Access;
  /** The setting that decides it, as the user wrote it; none when they set none. */
  setting?: string;
}

export interface PermissionChoice {
  agent: AgentName;
  mode: PermissionMode;
}

/** The board's calls for how each agent's runs may act; see src/server/app.ts. */
export const permissionsApi = {
  list: () => request<PermissionView[]>("/api/agent-permissions"),
  set: (choice: PermissionChoice) =>
    send<PermissionView, PermissionChoice>("POST", "/api/agent-permissions", choice),
};
