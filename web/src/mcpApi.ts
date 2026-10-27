import { Schema } from "effect";

import { AgentName, request, send } from "./api.ts";

/** Where a server is set up: for every workspace, for this folder alone, or in its `.mcp.json`. */
export const McpSource = Schema.Literals(["user", "local", "project"]);

export type McpSource = typeof McpSource.Type;

/** Off until the user decides, and asked again when how it starts changed since they turned it on. */
export const McpState = Schema.Literals(["on", "off", "new", "changed"]);

export type McpState = typeof McpState.Type;

export const McpLaunchView = Schema.Struct({
  /** Whether it is reached at an address or started by a command. */
  kind: Schema.Literals(["url", "command"]),
  /** The command line, or the address without anything that could be a key. */
  launch: Schema.String,
  /** A command that runs to make its headers. */
  helper: Schema.optionalKey(Schema.String),
  /** Names only, never values. */
  env: Schema.Array(Schema.String),
  headers: Schema.Array(Schema.String),
});

export type McpLaunchView = typeof McpLaunchView.Type;

export const McpServerView = Schema.Struct({
  agent: AgentName,
  name: Schema.String,
  source: McpSource,
  state: McpState,
  fingerprint: Schema.String,
  ...McpLaunchView.fields,
});

export type McpServerView = typeof McpServerView.Type;

/** A plugin of the user's agent that brings MCP servers, which the user turns on or off as one. */
export const McpPluginView = Schema.Struct({
  agent: AgentName,
  /** As the agent names it: `name@marketplace`. */
  id: Schema.String,
  title: Schema.String,
  description: Schema.optionalKey(Schema.String),
  /** Its picture as a `data:` address. */
  logo: Schema.optionalKey(Schema.String),
  state: McpState,
  fingerprint: Schema.String,
  servers: Schema.Array(Schema.Struct({ name: Schema.String, ...McpLaunchView.fields })),
});

export type McpPluginView = typeof McpPluginView.Type;

export const McpServersStatus = Schema.Struct({
  servers: Schema.Array(McpServerView),
  plugins: Schema.Array(McpPluginView),
  problems: Schema.Array(Schema.String),
});

export type McpServersStatus = typeof McpServersStatus.Type;

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
  servers: () => request(McpServersStatus, "/api/mcp-servers"),
  decide: (decision: McpDecision) => send(McpServerView, "POST", "/api/mcp-servers", decision),
  decidePlugin: (decision: McpPluginDecision) =>
    send(McpPluginView, "POST", "/api/mcp-plugins", decision),
};
