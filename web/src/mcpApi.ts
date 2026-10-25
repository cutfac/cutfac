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
  /** Whether it is reached at an address or started by a command. */
  kind: "url" | "command";
  /** The command line, or the address without anything that could be a key. */
  launch: string;
  /** A command that runs to make its headers. */
  helper?: string;
  /** Names only, never values. */
  env: string[];
  headers: string[];
}

/** How a server starts, as the user looks it over. */
export type McpLaunchView = Pick<McpServerView, "kind" | "launch" | "helper" | "env" | "headers">;

/** A plugin of the user's agent that brings MCP servers, which the user turns on or off as one. */
export interface McpPluginView {
  agent: AgentName;
  /** As the agent names it: `name@marketplace`. */
  id: string;
  title: string;
  description?: string;
  /** Its picture as a `data:` address. */
  logo?: string;
  state: McpState;
  fingerprint: string;
  servers: (McpLaunchView & { name: string })[];
}

export interface McpServersStatus {
  servers: McpServerView[];
  plugins: McpPluginView[];
  problems: string[];
}

export interface McpDecision {
  agent: AgentName;
  name: string;
  fingerprint: string;
  on: boolean;
}

export interface McpPluginDecision {
  agent: AgentName;
  id: string;
  fingerprint: string;
  on: boolean;
}

/** The board's calls for the MCP servers runs from it may use; see src/server/app.ts. */
export const mcpApi = {
  servers: () => request<McpServersStatus>("/api/mcp-servers"),
  decide: (decision: McpDecision) =>
    send<McpServerView, McpDecision>("POST", "/api/mcp-servers", decision),
  decidePlugin: (decision: McpPluginDecision) =>
    send<McpPluginView, McpPluginDecision>("POST", "/api/mcp-plugins", decision),
};
