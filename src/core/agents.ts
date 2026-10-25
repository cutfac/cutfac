import { Config, Effect, Option, Path, Schema } from "effect";

import { type OutdatedAgent, detectAgentRelease, outdatedAgent } from "./agentVersion.ts";
import { WorkspaceError } from "./errors.ts";
import type { CodexListed, CodexTransport } from "./mcpServers.ts";
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
export const LEGACY_SERVER_NAME = "content-factory";

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
  "render",
  "resolve_feedback",
  "save_variant",
  "save_format",
  "send_feedback_to_cutfac",
] as const;

/**
 * The MCP tools that send what the user has to see and agree to first. A Claude run from the board
 * asks the board for them each time; a run that can't ask, such as Codex's or an import's, never
 * gets them.
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

/** This workspace's entry in `file`, when it starts the server for `root`. */
const ourEntry = (file: Schema.JsonObject, root: string) => {
  const entry = serversOf(file)[SERVER_NAME];

  return Option.exists(decodeLaunchArgs(entry), ({ args }) => targetsRoot(args, root))
    ? entry
    : undefined;
};

/**
 * Claude's `--mcp-config`, as a JSON string, with `server` as this workspace's, and `others` the
 * user turned on for runs.
 */
export const ourMcpConfig = (server: McpLaunch | Schema.Json, others: Schema.JsonObject = EMPTY) =>
  JSON.stringify({ mcpServers: { ...others, [SERVER_NAME]: server } });

/** Claude's `--mcp-config` with only the servers the user turned on, or none without any. */
const othersMcpConfig = (others: Schema.JsonObject) =>
  Object.keys(others).length === 0 ? undefined : JSON.stringify({ mcpServers: others });

/**
 * Claude's `--mcp-config` for a run: this workspace's server, started for `launch`'s root, or
 * without it, as `.mcp.json` has it when that starts the server for this root; and `others`, the
 * servers the user turned on for runs. The run loads no other server, so none the user or the
 * workspace set up can act for it unasked.
 */
export const runMcpConfig = Effect.fn("agents.runMcpConfig")(function* (
  launch: McpLaunch | undefined,
  others: Schema.JsonObject = EMPTY,
) {
  if (launch !== undefined) return ourMcpConfig(launch, others);

  const ws = yield* Workspace;
  const entry = ourEntry(yield* readMcpFile().pipe(Effect.orElseSucceed(() => EMPTY)), ws.root);

  if (entry !== undefined) return ourMcpConfig(entry, others);

  return othersMcpConfig(others);
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

/**
 * The Codex config entries for a run's own server `name`: without the tools only the user's own
 * session may call, and the rest called without asking. A run has no one to ask, so Codex would
 * refuse every tool marked as overwriting, such as update_item and review_media.
 */
const codexOursForRun = (name: string) => [
  `${codexServerKey(name)}.disabled_tools=${JSON.stringify(MCP_USER_ONLY_TOOLS)}`,
  `${codexServerKey(name)}.default_tools_approval_mode="approve"`,
];

/**
 * Codex config entries for a headless run: the server `name` started with `launch`, whatever the
 * user config says, as a run's own server.
 */
export const codexServerLaunch = (name: string, launch: McpLaunch) => [
  `${codexServerKey(name)}.command=${JSON.stringify(launch.command)}`,
  `${codexServerKey(name)}.args=${JSON.stringify(launch.args)}`,
  ...codexOursForRun(name),
];

/**
 * What a switched-off server launches instead, by the kind Codex listed. A plugin's server has no
 * entry in the user's config, and an entry with no launch stops Codex from starting, so switching
 * one off gives it a whole entry. Codex never starts or reaches a server that is off.
 */
const CODEX_STAND_INS: Record<CodexTransport, string> = {
  stdio: 'command="false"',
  streamable_http: 'url="http://127.0.0.1:9"',
};

/** The Codex config entries that switch off the server Codex `listed`. */
function codexServerOff({ name, transport }: CodexListed): string[] {
  const key = codexServerKey(name);
  const standIn = transport === undefined ? [] : [`${key}.${CODEX_STAND_INS[transport]}`];

  return [`${key}.enabled=false`, ...standIn];
}

/**
 * Codex config entries that keep a run on this workspace's server, `ours`, and the ones the user
 * turned on for runs, `kept`, out of the servers Codex `listed`. Every other server is switched
 * off, plugins' too, and apps with the connectors they bring, so nothing the user or another
 * workspace set up can act for the run unasked, and ours goes without the tools only the user's
 * own session may call and calls the rest without asking. Plugins stay on for their skills. With
 * `launch`, ours is started for this root; without it, ours is used as registered.
 */
export function codexRunServers(
  ours: string,
  launch: McpLaunch | undefined,
  listed: ReadonlyArray<CodexListed>,
  kept: ReadonlyArray<string> = [],
): string[] {
  const others = [
    "features.apps=false",
    ...listed.flatMap((server) =>
      !server.enabled || server.name === ours || kept.includes(server.name)
        ? []
        : codexServerOff(server),
    ),
  ];

  if (launch !== undefined) return [...others, ...codexServerLaunch(ours, launch)];

  // An entry with no command stops Codex from starting, so ours is narrowed only when registered.
  return listed.some((server) => server.name === ours)
    ? [...others, ...codexOursForRun(ours)]
    : others;
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

/** The environment variable `name`, or none. */
export const envVar = (name: string) =>
  Config.option(Config.String(name)).pipe(Effect.orElseSucceed(Option.none));

/** A file outside the workspace, or nothing when it is missing or unreadable. */
const peek = (full: string) =>
  Effect.flatMap(Workspace, (ws) => ws.peekText(full, SETTINGS_BYTES)).pipe(Effect.option);

/** Codex's own folder, which holds the user's `config.toml`. */
export const codexHome = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* envVar("HOME");

  return Option.orElse(yield* envVar("CODEX_HOME"), () =>
    Option.map(home, (dir) => path.join(dir, ".codex")),
  );
});

/** Claude Code's own folder, which holds the user's settings and plugins. */
export const claudeConfigDir = Effect.gen(function* () {
  const path = yield* Path.Path;
  const home = yield* envVar("HOME");

  return Option.orElse(yield* envVar("CLAUDE_CONFIG_DIR"), () =>
    Option.map(home, (dir) => path.join(dir, ".claude")),
  );
});

/** Claude Code's settings files for this workspace, the one that wins first: its own, then the user's. */
export const claudeSettingsFiles = Effect.gen(function* () {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const configDir = yield* claudeConfigDir;

  return [
    path.join(ws.root, ".claude", "settings.local.json"),
    path.join(ws.root, ".claude", "settings.json"),
    ...Option.toArray(Option.map(configDir, (dir) => path.join(dir, "settings.json"))),
  ];
});

/**
 * The model Claude Code runs when none is picked, as its own settings set it: the environment,
 * then this workspace's settings, then the user's.
 */
const claudeDefaultModel = Effect.fn("agents.claudeDefaultModel")(function* () {
  const fromEnv = yield* envVar("ANTHROPIC_MODEL");

  if (Option.isSome(fromEnv)) return claudeModelName(fromEnv.value);

  for (const file of yield* claudeSettingsFiles) {
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
  const dir = yield* codexHome;

  if (Option.isNone(dir)) return undefined;

  const config = yield* peek(path.join(dir.value, "config.toml"));

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
    Effect.map((file) => ourEntry(file, ws.root) !== undefined),
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
