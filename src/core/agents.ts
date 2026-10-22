import { Config, Effect, Option, Path, Schema } from "effect";

import { type OutdatedAgent, detectAgentRelease, outdatedAgent } from "./agentVersion.ts";
import { CommandFailed, WorkspaceError } from "./errors.ts";
import {
  type AgentModels,
  CLAUDE_MODELS,
  NO_MODELS,
  claudeModelName,
  codexConfigModel,
  codexDefaultModel,
  codexModels,
} from "./models.ts";
import { run, which } from "./process.ts";
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
  /** The release the CLI reports, when it does. */
  readonly version?: string | undefined;
  /** Set when that release is older than Cutfac supports, with how to update it. */
  readonly outdated?: OutdatedAgent | undefined;
}

export const SERVER_NAME = "cutfac";

/** What agents knew the server as before Content Factory was renamed to Cutfac. */
const LEGACY_SERVER_NAME = "content-factory";

/** Claude Code's `--allowedTools` entry for every tool this server offers. */
export const CLAUDE_MCP_TOOLS = `mcp__${SERVER_NAME}`;

/** Claude Code's name for one of this server's tools. */
export const claudeMcpTool = (name: string) => `${CLAUDE_MCP_TOOLS}__${name}`;

/** The MCP tools that only read the workspace: all an agent may call before the user allows more. */
export const MCP_READ_TOOLS = [
  "workspace_overview",
  "list_items",
  "get_item",
  "verify_item",
  "list_open_feedback",
  "list_formats",
  "get_format",
  "check_format",
  "get_skill",
] as const;

/** The MCP tools that write to the workspace or reach the network. */
export const MCP_WRITE_TOOLS = [
  "learn",
  "update_brief",
  "create_item",
  "update_item",
  "review_media",
  "resolve_feedback",
  "save_variant",
  "save_format",
  "send_feedback_to_cutfac",
] as const;

/**
 * The MCP tools a headless run from the board never gets: they send what the user has to see and
 * agree to first, and no one is there to ask.
 */
export const MCP_USER_ONLY_TOOLS = ["send_feedback_to_cutfac"] as const satisfies ReadonlyArray<
  (typeof MCP_WRITE_TOOLS)[number]
>;

const MCP_FILE = ".mcp.json";

/** How an agent should start this workspace's MCP server. */
export const mcpLaunch = (cli: CliEntry, root: string): McpLaunch => ({
  command: cli.command,
  args: [...cli.args, "mcp", "--workspace", root],
});

const McpFile = Schema.fromJsonString(Schema.JsonObject, { space: 2 });

const decodeMcpFile = Schema.decodeUnknownEffect(McpFile);

const encodeMcpFile = (file: Schema.JsonObject) =>
  Schema.encodeEffect(McpFile)(file).pipe(
    Effect.mapError(
      (error) => new WorkspaceError({ message: `Could not encode ${MCP_FILE}: ${error.message}` }),
    ),
  );

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

const LaunchArgs = Schema.Struct({ args: Schema.Array(Schema.String) });

const decodeLaunchArgs = Schema.decodeUnknownOption(LaunchArgs);

/**
 * Whether a server's launch `args` start the MCP server for `root`. A workspace copied or moved
 * elsewhere keeps an entry for its old root, which would act on the wrong files.
 */
export const targetsRoot = (args: ReadonlyArray<string>, root: string) =>
  args.some((arg, i) => arg === "--workspace" && args[i + 1] === root);

/** `file` with this server's entry set to `launch`, and the one from before the rename gone. */
const withOurServer = (file: Schema.JsonObject, launch: McpLaunch): Schema.JsonObject => ({
  ...file,
  mcpServers: {
    ...Object.fromEntries(
      Object.entries(serversOf(file)).filter(([name]) => name !== LEGACY_SERVER_NAME),
    ),
    [SERVER_NAME]: { command: launch.command, args: launch.args },
  },
});

/**
 * The workspace's `.mcp.json` for a run, as a JSON string, with this server always started for
 * `launch`'s root whatever the file says. The file's other servers are kept.
 */
export const runMcpConfig = Effect.fn("agents.runMcpConfig")(function* (launch: McpLaunch) {
  const file = yield* readMcpFile().pipe(Effect.orElseSucceed(() => EMPTY));

  return yield* encodeMcpFile(withOurServer(file, launch));
});

/**
 * Claude Code reads project-scoped servers from .mcp.json at the workspace root, so connecting
 * never touches global config. Other servers and keys in the file are kept, except the entry this
 * server had under its name from before the rename.
 */
export const connectClaude = Effect.fn("agents.connectClaude")(function* (launch: McpLaunch) {
  const ws = yield* Workspace;
  const current = yield* readMcpFile();

  const text = yield* encodeMcpFile(withOurServer(current, launch));

  yield* ws.writeText(MCP_FILE, `${text}\n`);

  const connection: AgentConnection = {
    agent: "claude",
    ok: true,
    detail: `${MCP_FILE} → open Claude Code in ${ws.root} and approve the "${SERVER_NAME}" server`,
  };

  return connection;
});

/** Codex keeps MCP servers in one user config, so each workspace registers under its own name. */
const codexNameUnder = (server: string, workspaceName: string) =>
  `${server}-${slugify(workspaceName) || "workspace"}`;

export const codexServerName = (workspaceName: string) =>
  codexNameUnder(SERVER_NAME, workspaceName);

/** A TOML key: bare when it can be, quoted otherwise. */
const tomlKey = (name: string) => (/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name));

/** Where Codex's config keeps the MCP server `name`. */
export const codexServerKey = (name: string) => `mcp_servers.${tomlKey(name)}`;

/** Whether `name` is how some workspace registered its server with Codex, now or before the rename. */
const isCodexWorkspaceServer = (name: string) =>
  [SERVER_NAME, LEGACY_SERVER_NAME].some((server) => name.startsWith(`${server}-`));

/** The Codex config entry that takes the tools only the user's own session may call off `name`. */
const codexUserOnlyOff = (name: string) =>
  `${codexServerKey(name)}.disabled_tools=${JSON.stringify(MCP_USER_ONLY_TOOLS)}`;

/**
 * Codex config entries for a headless run: the server `name` started with `launch`, whatever the
 * user config says, without the tools only the user's own session may call.
 */
export const codexServerLaunch = (name: string, launch: McpLaunch) => [
  `${codexServerKey(name)}.command=${JSON.stringify(launch.command)}`,
  `${codexServerKey(name)}.args=${JSON.stringify(launch.args)}`,
  codexUserOnlyOff(name),
];

const CodexServers = Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String })));

const decodeCodexServers = Schema.decodeUnknownOption(CodexServers);

/** Listing servers reads a config file; a Codex that takes longer is stuck, not slow. */
const LIST_TIMEOUT = "15 seconds";

/**
 * The MCP servers in the user's Codex config, which a run loads unless it switches them off.
 * Without this list a run could reach a server that writes, so it fails when Codex cannot give it.
 */
export const codexServerNames = Effect.fn("agents.codexServerNames")(function* (bin: string) {
  const ws = yield* Workspace;

  const failed = new CommandFailed({
    message: "Could not list Codex's MCP servers to switch off the ones this run must not reach",
  });

  const listed = yield* run(bin, ["mcp", "list", "--json", "-c", "features.plugins=false"], {
    cwd: ws.root,
  }).pipe(Effect.timeoutOrElse({ duration: LIST_TIMEOUT, orElse: () => Effect.fail(failed) }));

  const servers = listed.code === 0 ? decodeCodexServers(listed.stdout) : Option.none();

  if (Option.isNone(servers)) return yield* failed;

  return servers.value.map((server) => server.name);
});

/**
 * Codex config entries that keep a board run on this workspace's server, `ours`, out of the
 * servers Codex `listed`. Every other workspace's server is switched off, so the run never acts on
 * a workspace it was not started for, and ours goes without the tools only the user's own session
 * may call. With `launch`, ours is started for this root; without it, ours is used as registered.
 */
export function codexRunServers(
  ours: string,
  launch: McpLaunch | undefined,
  listed: ReadonlyArray<string>,
): string[] {
  const others = listed.flatMap((name) =>
    name !== ours && isCodexWorkspaceServer(name) ? [`${codexServerKey(name)}.enabled=false`] : [],
  );

  if (launch !== undefined) return [...others, ...codexServerLaunch(ours, launch)];

  // An entry with no command stops Codex from starting, so ours is narrowed only when registered.
  return listed.includes(ours) ? [...others, codexUserOnlyOff(ours)] : others;
}

const CodexServer = Schema.fromJsonString(Schema.Struct({ transport: LaunchArgs }));

const decodeCodexServer = Schema.decodeUnknownOption(CodexServer);

/**
 * Codex only reads MCP servers from its user config, so register through its own CLI instead of
 * editing ~/.codex/config.toml by hand. Re-registering replaces a stale launch command, and the
 * registration from before the rename.
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

  for (const stale of [codexNameUnder(LEGACY_SERVER_NAME, ws.config.name), name]) {
    const existing = yield* run(codex.value, ["mcp", "get", stale]);

    if (existing.code === 0) yield* run(codex.value, ["mcp", "remove", stale]);
  }

  const added = yield* run(codex.value, ["mcp", "add", name, "--", launch.command, ...launch.args]);

  const connection: AgentConnection =
    added.code === 0
      ? { agent: "codex", ok: true, detail: `registered "${name}" in ~/.codex/config.toml` }
      : { agent: "codex", ok: false, detail: `${added.stdout}${added.stderr}`.trim() };

  return connection;
});

export const connectAgent = (agent: AgentName, launch: McpLaunch) =>
  agent === "claude" ? connectClaude(launch) : connectCodex(launch);

/** Enough of a settings or config file to find the model in it. */
const SETTINGS_BYTES = 1024 * 1024;

const ModelSetting = Schema.fromJsonString(
  Schema.Struct({ model: Schema.optional(Schema.String) }),
);

const decodeModelSetting = Schema.decodeUnknownOption(ModelSetting);

const env = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(Option.none));

/** A file outside the workspace, or nothing when it is missing or unreadable. */
const peek = (full: string) =>
  Effect.flatMap(Workspace, (ws) => ws.peekText(full, SETTINGS_BYTES)).pipe(Effect.option);

/**
 * The model Claude Code runs when none is picked, as its own settings set it: the environment,
 * then this workspace's settings, then the user's.
 */
const claudeDefaultModel = Effect.fn("agents.claudeDefaultModel")(function* () {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const fromEnv = yield* env("ANTHROPIC_MODEL");

  if (Option.isSome(fromEnv)) return claudeModelName(fromEnv.value);

  const home = yield* env("HOME");

  const configDir = Option.orElse(yield* env("CLAUDE_CONFIG_DIR"), () =>
    Option.map(home, (dir) => path.join(dir, ".claude")),
  );

  const files = [
    path.join(ws.root, ".claude", "settings.local.json"),
    path.join(ws.root, ".claude", "settings.json"),
    ...Option.toArray(Option.map(configDir, (dir) => path.join(dir, "settings.json"))),
  ];

  for (const file of files) {
    const model = Option.flatMap(yield* peek(file), decodeModelSetting).pipe(
      Option.flatMapNullishOr((settings) => settings.model),
    );

    if (Option.isSome(model)) return claudeModelName(model.value);
  }

  return undefined;
});

/** The model Codex's own `config.toml` sets, if any. */
const codexConfiguredModel = Effect.fn("agents.codexConfiguredModel")(function* () {
  const path = yield* Path.Path;
  const home = yield* env("HOME");

  const codexHome = Option.orElse(yield* env("CODEX_HOME"), () =>
    Option.map(home, (dir) => path.join(dir, ".codex")),
  );

  if (Option.isNone(codexHome)) return undefined;

  const config = yield* peek(path.join(codexHome.value, "config.toml"));

  return Option.isSome(config) ? codexConfigModel(config.value) : undefined;
});

/**
 * Whether each supported agent CLI is installed and already pointed at this workspace, and the
 * models it can run. An entry for another root, as in a copied workspace, is not connected, so
 * connecting again fixes it.
 */
export const agentStatus = Effect.fn("agents.agentStatus")(function* () {
  const ws = yield* Workspace;

  const claudeConnected = yield* readMcpFile().pipe(
    Effect.map((file) =>
      Option.exists(decodeLaunchArgs(serversOf(file)[SERVER_NAME]), ({ args }) =>
        targetsRoot(args, ws.root),
      ),
    ),
    Effect.orElseSucceed(() => false),
  );

  const claude = yield* which("claude");
  const codex = yield* which("codex");

  const codexStatus = Option.match(codex, {
    onNone: () => Effect.succeed([false, NO_MODELS, undefined] as const),
    onSome: (bin) =>
      Effect.all(
        [
          run(bin, ["mcp", "get", codexServerName(ws.config.name), "--json"]).pipe(
            Effect.map(
              (result) =>
                result.code === 0 &&
                Option.exists(decodeCodexServer(result.stdout), (server) =>
                  targetsRoot(server.transport.args, ws.root),
                ),
            ),
            Effect.orElseSucceed(() => false),
          ),
          Effect.zipWith(codexModels(bin), codexConfiguredModel(), (offers, configured) => ({
            ...offers,
            defaultModel: codexDefaultModel(offers, configured),
          })),
          detectAgentRelease(bin),
        ],
        { concurrency: "unbounded" },
      ),
  });

  const [[codexConnected, codexOffers, codexRelease], claudeRelease] = yield* Effect.all(
    [
      codexStatus,
      Option.match(claude, { onNone: () => Effect.undefined, onSome: detectAgentRelease }),
    ],
    { concurrency: "unbounded" },
  );

  const status: ReadonlyArray<AgentStatus> = [
    {
      agent: "claude",
      installed: Option.isSome(claude),
      connected: claudeConnected,
      version: claudeRelease?.version,
      outdated: outdatedAgent("claude", claudeRelease),
      ...CLAUDE_MODELS,
      defaultModel: yield* claudeDefaultModel(),
    },
    {
      agent: "codex",
      installed: Option.isSome(codex),
      connected: codexConnected,
      version: codexRelease?.version,
      outdated: outdatedAgent("codex", codexRelease),
      ...codexOffers,
    },
  ];

  return status;
});
