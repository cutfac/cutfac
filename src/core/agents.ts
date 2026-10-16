import { Effect, Option, Schema } from "effect";

import { WorkspaceError } from "./errors.ts";
import { type AgentModels, CLAUDE_MODELS, NO_MODELS, codexModels } from "./models.ts";
import { isInstalled, run, which } from "./process.ts";
import type { AgentName } from "./schema.ts";
import { Workspace, slugify } from "./workspace.ts";

/** How to start this CLI: `bun src/cli.ts` from source, or the compiled binary on its own. */
export interface CliEntry {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface McpLaunch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
}

export interface AgentConnection {
  readonly agent: AgentName;
  readonly ok: boolean;
  readonly detail: string;
}

/** Whether the agent can run here, and the models the board may offer it. */
export interface AgentStatus extends AgentModels {
  readonly agent: AgentName;
  readonly installed: boolean;
  readonly connected: boolean;
}

export const SERVER_NAME = "content-factory";

/** The MCP tools that only read the workspace: all an agent may call before the user allows more. */
export const MCP_READ_TOOLS = [
  "workspace_overview",
  "get_product",
  "list_items",
  "get_item",
  "verify_item",
  "list_open_feedback",
  "list_references",
  "get_reference",
  "list_formats",
  "get_format",
  "check_format",
  "get_skill",
] as const;

/** The MCP tools that write to the workspace or reach the network. */
export const MCP_WRITE_TOOLS = [
  "import_product",
  "create_item",
  "update_item",
  "review_media",
  "resolve_feedback",
  "add_reference",
  "preprocess_reference",
  "save_reference_analysis",
  "save_format",
] as const;

const MCP_FILE = ".mcp.json";

/** How an agent should start this workspace's MCP server. */
export const mcpLaunch = (cli: CliEntry, root: string): McpLaunch => ({
  command: cli.command,
  args: [...cli.args, "mcp", "--workspace", root],
});

const McpFile = Schema.fromJsonString(Schema.JsonObject, { space: 2 });

const decodeMcpFile = Schema.decodeUnknownEffect(McpFile);

const encodeMcpFile = Schema.encodeEffect(McpFile);

const decodeServers = Schema.decodeUnknownOption(Schema.JsonObject);

const EMPTY: Schema.JsonObject = {};

/** `.mcp.json` as it is, or an empty object when the workspace has none. */
const readMcpFile = Effect.fn("agents.readMcpFile")(function* () {
  const ws = yield* Workspace;

  if (!(yield* ws.exists(MCP_FILE))) return EMPTY;
  const text = yield* ws.readText(MCP_FILE);

  return yield* decodeMcpFile(text).pipe(
    Effect.mapError(
      (error) =>
        new WorkspaceError({ message: `${MCP_FILE} is not a JSON object: ${error.message}` }),
    ),
  );
});

const serversOf = (file: Schema.JsonObject) =>
  Option.getOrElse(decodeServers(file["mcpServers"]), () => EMPTY);

/**
 * Claude Code reads project-scoped servers from .mcp.json at the workspace root, so connecting
 * never touches global config. Other servers and keys in the file are kept.
 */
export const connectClaude = Effect.fn("agents.connectClaude")(function* (launch: McpLaunch) {
  const ws = yield* Workspace;
  const current = yield* readMcpFile();

  const next = {
    ...current,
    mcpServers: {
      ...serversOf(current),
      [SERVER_NAME]: { command: launch.command, args: launch.args },
    },
  };

  const text = yield* encodeMcpFile(next).pipe(
    Effect.mapError(
      (error) => new WorkspaceError({ message: `Could not encode ${MCP_FILE}: ${error.message}` }),
    ),
  );

  yield* ws.writeText(MCP_FILE, `${text}\n`);

  const connection: AgentConnection = {
    agent: "claude",
    ok: true,
    detail: `${MCP_FILE} → open Claude Code in ${ws.root} and approve the "${SERVER_NAME}" server`,
  };

  return connection;
});

/** Codex keeps MCP servers in one user config, so each workspace registers under its own name. */
export const codexServerName = (workspaceName: string) =>
  `${SERVER_NAME}-${slugify(workspaceName) || "workspace"}`;

/**
 * Codex only reads MCP servers from its user config, so register through its own CLI instead of
 * editing ~/.codex/config.toml by hand. Re-registering replaces a stale launch command.
 */
export const connectCodex = Effect.fn("agents.connectCodex")(function* (launch: McpLaunch) {
  const ws = yield* Workspace;
  const codex = yield* which("codex");

  if (Option.isNone(codex)) {
    const missing: AgentConnection = {
      agent: "codex",
      ok: false,
      detail: "codex CLI not found on PATH",
    };

    return missing;
  }

  const name = codexServerName(ws.config.name);
  const existing = yield* run(codex.value, ["mcp", "get", name]);

  if (existing.code === 0) yield* run(codex.value, ["mcp", "remove", name]);
  const added = yield* run(codex.value, ["mcp", "add", name, "--", launch.command, ...launch.args]);

  const connection: AgentConnection =
    added.code === 0
      ? { agent: "codex", ok: true, detail: `registered "${name}" in ~/.codex/config.toml` }
      : { agent: "codex", ok: false, detail: `${added.stdout}${added.stderr}`.trim() };

  return connection;
});

export const connectAgent = (agent: AgentName, launch: McpLaunch) =>
  agent === "claude" ? connectClaude(launch) : connectCodex(launch);

/**
 * Whether each supported agent CLI is installed and already pointed at this workspace, and the
 * models it can run.
 */
export const agentStatus = Effect.fn("agents.agentStatus")(function* () {
  const ws = yield* Workspace;

  const claudeConnected = yield* readMcpFile().pipe(
    Effect.map((file) => serversOf(file)[SERVER_NAME] !== undefined),
    Effect.orElseSucceed(() => false),
  );

  const codex = yield* which("codex");

  const [codexConnected, codexOffers] = yield* Option.match(codex, {
    onNone: () => Effect.succeed([false, NO_MODELS] as const),
    onSome: (bin) =>
      Effect.all(
        [
          run(bin, ["mcp", "get", codexServerName(ws.config.name)]).pipe(
            Effect.map((result) => result.code === 0),
            Effect.orElseSucceed(() => false),
          ),
          codexModels(bin),
        ],
        { concurrency: "unbounded" },
      ),
  });

  const status: ReadonlyArray<AgentStatus> = [
    {
      agent: "claude",
      installed: yield* isInstalled("claude"),
      connected: claudeConnected,
      ...CLAUDE_MODELS,
    },
    { agent: "codex", installed: Option.isSome(codex), connected: codexConnected, ...codexOffers },
  ];

  return status;
});
