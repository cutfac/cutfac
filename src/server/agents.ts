import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import {
  PermissionChoice,
  agentPermissions,
  setAgentPermissions,
} from "../core/agentPermissions.ts";
import { type CliEntry, agentStatus, connectAgent, mcpLaunch } from "../core/agents.ts";
import { InvalidRequest } from "../core/errors.ts";
import {
  McpDecision,
  McpPluginDecision,
  decideMcpPlugin,
  decideMcpServer,
  mcpServersStatus,
} from "../core/mcpApprovals.ts";
import { AgentName } from "../core/schema.ts";
import { Workspace, type WorkspaceService } from "../core/workspace.ts";
import { trustStatus, trustWorkspace } from "../core/workspaceTrust.ts";
import { json } from "./respond.ts";

const ConnectBody = Schema.Struct({ agent: AgentName });

const TrustBody = Schema.Struct({ fingerprint: Schema.NonEmptyString });

/** The agent a run uses when the request does not name one. */
export const defaultAgent = (ws: WorkspaceService): AgentName =>
  ws.config.agent.default === "queue" ? "claude" : ws.config.agent.default;

/** How agents launch this workspace's MCP server. `instead` says what to do when that is unknown. */
export const ownLaunch = Effect.fnUntraced(function* (cli: CliEntry | undefined, instead: string) {
  const ws = yield* Workspace;

  if (cli === undefined) {
    return yield* new InvalidRequest({
      message: `This server does not know how it was launched; ${instead}`,
    });
  }

  return mcpLaunch(cli, ws.root);
});

export const agentRoutes = (cli: CliEntry | undefined) =>
  HttpRouter.addAll([
    json("GET", "/api/agents", agentStatus()),
    json("GET", "/api/trust", trustStatus()),
    json(
      "POST",
      "/api/trust",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(TrustBody), (body) =>
        trustWorkspace(body.fingerprint),
      ),
    ),
    json("GET", "/api/agent-permissions", agentPermissions()),
    json(
      "POST",
      "/api/agent-permissions",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(PermissionChoice), setAgentPermissions),
    ),
    json("GET", "/api/mcp-servers", mcpServersStatus()),
    json(
      "POST",
      "/api/mcp-servers",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(McpDecision), decideMcpServer),
    ),
    json(
      "POST",
      "/api/mcp-plugins",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(McpPluginDecision), decideMcpPlugin),
    ),
    json(
      "POST",
      "/api/agents/connect",
      Effect.gen(function* () {
        const { agent } = yield* HttpServerRequest.schemaBodyJson(ConnectBody);
        const server = yield* ownLaunch(cli, "run `cutfac agent-setup --connect` instead");

        return yield* connectAgent(agent, server);
      }),
    ),
  ]);
