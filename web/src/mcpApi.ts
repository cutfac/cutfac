import { type AgentName, request, send } from "./api.ts";

/** Where a server is set up: for every workspace, for this folder alone, or in its `.mcp.json`. */
export type McpSource = "user" | "local" | "project";

/** Off until the user decides, and asked again when how it starts changed since they turned it on. */
export type McpState = "on" | "off" | "new" | "changed";

/** An MCP server the user set up for their agent, as they decide on it. */
export interface McpServerView {
  agent: AgentName;
  name: string;
  source: McpSource;
  state: McpState;
  /** Names how it starts as shown, so turning it on doesn't agree to a change since. */
  fingerprint: string;
  /** The command line, or the address without anything that could be a key. */
  launch: string;
  /** A command that runs to make its headers. */
  helper?: string;
  /** Names only, never values. */
  env: string[];
  headers: string[];
}

export interface McpServersStatus {
  servers: McpServerView[];
  problems: string[];
}

export interface McpDecision {
  agent: AgentName;
  name: string;
  fingerprint: string;
  on: boolean;
}

/** The board's calls for the MCP servers runs from it may use; see src/server/app.ts. */
export const mcpApi = {
  servers: () => request<McpServersStatus>("/api/mcp-servers"),
  decide: (decision: McpDecision) =>
    send<McpServerView, McpDecision>("POST", "/api/mcp-servers", decision),
};
