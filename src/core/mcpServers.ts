import { Effect, Option, Path, Predicate, Schema } from "effect";

import { LEGACY_SERVER_NAME, SERVER_NAME, codexHome, envVar } from "./agents.ts";
import { CommandFailed } from "./errors.ts";
import { canonicalJson, isEmptyJson, isJsonObject } from "./json.ts";
import { readOptionalText } from "./library.ts";
import { run } from "./process.ts";
import type { AgentName } from "./schema.ts";
import { sha256 } from "./skill.ts";
import { Workspace } from "./workspace.ts";

/**
 * Where an MCP server is set up: the user's own agent config, which every workspace shares;
 * Claude Code's config for this folder alone; or the workspace's `.mcp.json`.
 */
export type McpSource = "user" | "local" | "project";

/** An MCP server the user's agent has set up, its entry as the config has it, secrets and all. */
export interface McpServer {
  readonly agent: AgentName;
  readonly name: string;
  readonly source: McpSource;
  readonly entry: Schema.JsonObject;
}

/** The servers an agent has set up here, and why some of its config couldn't be read. */
export interface FoundServers {
  readonly servers: ReadonlyArray<McpServer>;
  readonly problems: ReadonlyArray<string>;
}

/** How Codex reaches a server it lists, of the kinds a run can switch off. */
const CodexTransport = Schema.Literals(["stdio", "streamable_http"]);

export type CodexTransport = typeof CodexTransport.Type;

/** A server Codex lists, on or off, as `codex mcp list` gives it. */
export interface CodexListed {
  readonly name: string;
  readonly enabled: boolean;
  readonly transport?: CodexTransport | undefined;
  readonly entry: Schema.JsonObject;
}

/** What the user sees of a server before turning it on: what it starts or reaches, and with what. */
export interface McpLaunchView {
  /** The command line, or the address without the part after `?`, which can carry a key. */
  readonly launch: string;
  /** A command that runs to make its headers. */
  readonly helper?: string | undefined;
  /** The names of the environment variables and headers it gets, never their values. */
  readonly env: ReadonlyArray<string>;
  readonly headers: ReadonlyArray<string>;
}

/** A server Cutfac sets up for runs itself, for this workspace or another. */
export const isCutfacServer = (name: string) =>
  [SERVER_NAME, LEGACY_SERVER_NAME].some((ours) => name === ours || name.startsWith(`${ours}-`));

/** Enough of a config file; Claude Code's record grows with every folder it opens. */
const CONFIG_BYTES = 16 * 1024 * 1024;

export const decodeJsonObject = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.JsonObject),
);

const decodeTable = Schema.decodeUnknownOption(Schema.JsonObject);

/** The servers in an `mcpServers` object, skipping anything that isn't one. */
export const entriesIn = (servers: Schema.Json | undefined) =>
  isJsonObject(servers)
    ? Object.entries(servers).flatMap(([name, entry]) =>
        isJsonObject(entry) ? [{ name, entry }] : [],
      )
    : [];

/** A config file read as JSON, and why it couldn't be. */
interface ConfigObject {
  readonly object: Schema.JsonObject;
  readonly problems: ReadonlyArray<string>;
}

/** `text`, the file `label`, as a JSON object: empty while there is none, with a problem when it isn't one. */
function jsonObjectIn(label: string, text: string | undefined): ConfigObject {
  if (text === undefined || text.trim() === "") return { object: {}, problems: [] };

  return Option.match(decodeJsonObject(text), {
    onNone: () => ({ object: {}, problems: [`${label} is not JSON Cutfac can read`] }),
    onSome: (object) => ({ object, problems: [] }),
  });
}

/** A file outside the workspace, or none while it is missing or can't be read. */
export const peekConfig = (full: string) =>
  Effect.flatMap(Workspace, (ws) => ws.peekText(full, CONFIG_BYTES)).pipe(
    Effect.asSome,
    Effect.orElseSucceed(Option.none),
  );

/** Claude Code's record of the user's config: `.claude.json` in its config folder, or at home. */
const claudeRecordFile = Effect.gen(function* () {
  const path = yield* Path.Path;
  const configDir = yield* envVar("CLAUDE_CONFIG_DIR");

  if (Option.isSome(configDir)) return Option.some(path.join(configDir.value, ".claude.json"));

  return Option.map(yield* envVar("HOME"), (home) => path.join(home, ".claude.json"));
});

/**
 * The servers Claude Code would load here: the user's, the workspace's `.mcp.json`, and the ones
 * set up for this folder alone, which win in that order when they share a name, as in Claude Code.
 */
export const claudeServers = Effect.fn("mcpServers.claude")(function* () {
  const ws = yield* Workspace;
  const file = yield* claudeRecordFile;
  const recordText = Option.isNone(file) ? Option.none() : yield* peekConfig(file.value);
  const record = jsonObjectIn("Claude Code's .claude.json", Option.getOrUndefined(recordText));

  const projectText = yield* readOptionalText(".mcp.json").pipe(Effect.orElseSucceed(() => ""));
  const project = jsonObjectIn(".mcp.json", projectText);

  const folders = record.object["projects"];
  const folder = isJsonObject(folders) ? folders[ws.root] : undefined;

  const scopes = [
    ["user", record.object["mcpServers"]],
    ["project", project.object["mcpServers"]],
    ["local", isJsonObject(folder) ? folder["mcpServers"] : undefined],
  ] as const;

  const found = new Map<string, McpServer>();

  for (const [source, servers] of scopes) {
    for (const { name, entry } of entriesIn(servers)) {
      if (!isCutfacServer(name)) found.set(name, { agent: "claude", name, source, entry });
    }
  }

  return {
    servers: [...found.values()],
    problems: [...record.problems, ...project.problems],
  } satisfies FoundServers;
});

const CodexListing = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      enabled: Schema.optionalKey(Schema.Json),
      transport: Schema.optionalKey(Schema.Json),
    }),
  ),
);

const decodeCodexListing = Schema.decodeUnknownOption(CodexListing);

const decodeTransport = Schema.decodeUnknownOption(Schema.Struct({ type: CodexTransport }));

/** Listing servers reads a config file; a Codex that takes longer is stuck, not slow. */
const LIST_TIMEOUT = "15 seconds";

/**
 * The MCP servers Codex loads here, from the user's config and plugins, as Codex itself reads them
 * with a run's features, which a run loads unless it switches them off. Without this list a run
 * could reach a server that writes, so it fails when Codex cannot give it.
 */
export const codexServers = Effect.fn("mcpServers.codex")(function* (bin: string) {
  const ws = yield* Workspace;

  const failed = new CommandFailed({
    message: "Could not list Codex's MCP servers to switch off the ones this run must not reach",
  });

  const listed = yield* run(bin, ["mcp", "list", "--json", "-c", "features.apps=false"], {
    cwd: ws.root,
  }).pipe(Effect.timeoutOrElse({ duration: LIST_TIMEOUT, orElse: () => Effect.fail(failed) }));

  const servers = listed.code === 0 ? decodeCodexListing(listed.stdout) : Option.none();

  if (Option.isNone(servers)) return yield* failed;

  return servers.value.map(({ name, enabled, transport }): CodexListed => ({
    name,
    enabled: enabled !== false,
    transport: Option.getOrUndefined(Option.map(decodeTransport(transport), ({ type }) => type)),
    entry: isJsonObject(transport) ? transport : {},
  }));
});

/** The servers in Codex's list that are on and not Cutfac's, which the user may turn on for runs. */
export const codexCandidates = (listed: ReadonlyArray<CodexListed>): ReadonlyArray<McpServer> =>
  listed.flatMap(({ name, enabled, entry }) =>
    enabled && !isCutfacServer(name) ? [{ agent: "codex", name, source: "user", entry }] : [],
  );

/** The tables under `key` in `toml`, a Codex `config.toml`, by name; none when it isn't TOML. */
export function tomlTables(toml: string, key: string) {
  let parsed: unknown;

  try {
    parsed = Bun.TOML.parse(toml);
  } catch {
    return [];
  }

  const tables = Predicate.hasProperty(parsed, key) ? parsed[key] : undefined;

  if (!Predicate.isObject(tables)) return [];

  return Object.entries(tables).flatMap(([name, value]) =>
    Option.match(decodeTable(value), {
      onNone: () => [],
      onSome: (table) => [[name, table] as const],
    }),
  );
}

/** The servers in `toml`, a Codex `config.toml`, that are on and not Cutfac's. */
export const configServers = (toml: string): ReadonlyArray<McpServer> =>
  codexCandidates(
    tomlTables(toml, "mcp_servers").map(([name, entry]) => ({
      name,
      enabled: entry["enabled"] !== false,
      entry,
    })),
  );

/**
 * The servers in the user's Codex `config.toml`, read without starting Codex, which takes too
 * long for every workspace_overview. Codex's own list stays the word on what a run loads.
 */
export const codexConfigServers = Effect.fn("mcpServers.codexConfig")(function* () {
  const path = yield* Path.Path;
  const dir = yield* codexHome;

  if (Option.isNone(dir)) return [];
  const text = yield* peekConfig(path.join(dir.value, "config.toml"));

  return Option.isNone(text) ? [] : configServers(text.value);
});

/** The parts of a Codex entry that decide what runs, which its config and its list both give. */
const CODEX_LAUNCH = [
  "command",
  "args",
  "env",
  "env_vars",
  "cwd",
  "url",
  "bearer_token_env_var",
  "http_headers",
  "env_http_headers",
  "http_headers_helper",
] as const;

/** Settings whose values are secrets, such as a key; their names are all that is shown or kept. */
const SECRET_MAPS = new Set(["env", "headers", "http_headers"]);

/** `fields` of a server's entry as the user agrees to them, its secrets kept as names. */
const setupOf = (fields: ReadonlyArray<readonly [string, Schema.Json | undefined]>) =>
  Object.fromEntries(
    fields.flatMap(([key, value]) => {
      if (value === undefined || isEmptyJson(value)) return [];

      return [[key, SECRET_MAPS.has(key) && isJsonObject(value) ? keysOf(value) : value]];
    }),
  ) satisfies Schema.JsonObject;

/** What the user agrees to in turning on a server set up as `entry`, every part of which counts. */
export const entrySetup = (entry: Schema.JsonObject) => setupOf(Object.entries(entry));

/** What the user agrees to in turning `server` on: how it starts, its secrets kept as names. */
export const approvedSetup = (server: McpServer) =>
  server.agent === "codex"
    ? setupOf(CODEX_LAUNCH.map((key) => [key, server.entry[key]] as const))
    : entrySetup(server.entry);

/** A name for exactly how `server` starts, so a change since the user turned it on is asked again. */
export const serverFingerprint = (server: McpServer) =>
  sha256(JSON.stringify(canonicalJson(approvedSetup(server))));

const strings = (value: Schema.Json | undefined) =>
  Array.isArray(value) ? value.filter(Predicate.isString) : [];

const keysOf = (value: Schema.Json | undefined) =>
  isJsonObject(value) ? Object.keys(value).toSorted() : [];

export const textOf = (value: Schema.Json | undefined) =>
  Predicate.isString(value) ? value : undefined;

/** `arg` as a shell would need it typed. */
const shellWord = (arg: string) =>
  /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;

/** `url` without the sign-in, query or fragment, any of which can carry a key. */
export function shownUrl(url: string) {
  const base = url.split(/[?#]/, 1)[0] ?? url;
  const bare = base.replace(/^([a-z][\w+.-]*:\/\/)[^/@]*@/i, "$1");

  return base === url ? bare : `${bare}?…`;
}

function launchOf(entry: Schema.JsonObject) {
  const url = textOf(entry["url"]);

  if (url !== undefined) return shownUrl(url);
  const command = textOf(entry["command"]);

  return command === undefined ? "" : [command, ...strings(entry["args"])].map(shellWord).join(" ");
}

export function launchView({ entry }: McpServer): McpLaunchView {
  const bearer = textOf(entry["bearer_token_env_var"]);

  return {
    launch: launchOf(entry),
    helper: textOf(entry["headersHelper"]) ?? textOf(entry["http_headers_helper"]),
    env: [
      ...keysOf(entry["env"]),
      ...strings(entry["env_vars"]),
      ...(bearer === undefined ? [] : [bearer]),
    ],
    headers: [
      ...keysOf(entry["headers"]),
      ...keysOf(entry["http_headers"]),
      ...keysOf(entry["env_http_headers"]),
    ],
  };
}

/** Claude Code's `--allowedTools` entry for every tool of the server `name`, as it names them. */
export const claudeServerTools = (name: string) =>
  `mcp__${name.replaceAll(/[^A-Za-z0-9_-]/g, "_")}`;

/** What a Claude run loads of the servers the user turned on. */
export interface ClaudeRunServers {
  /** Each by name, as its config has it, but with what could be a secret read from `env`. */
  readonly servers: Schema.JsonObject;
  /** The secrets, which Claude Code puts back in, out of the command line other users can see. */
  readonly env: Readonly<Record<string, string>>;
  readonly tools: ReadonlyArray<string>;
}

const SECRET_VAR = "CUTFAC_MCP_SECRET_";

/** `servers` as a Claude run loads them, the values of their secrets moved into variables. */
export function claudeRunServers(servers: ReadonlyArray<McpServer>): ClaudeRunServers {
  const env: Record<string, string> = {};

  // A value that names a variable already is not a secret, and Claude Code reads it once.
  const hide = (value: Schema.Json): Schema.Json => {
    if (!Predicate.isString(value) || value.includes("${")) return value;
    const name = `${SECRET_VAR}${Object.keys(env).length}`;
    env[name] = value;

    return `\${${name}}`;
  };

  // Arguments too, where a server is often given its key, as in `--api-key=…`.
  const hidden = (entry: Schema.JsonObject): Schema.JsonObject =>
    Object.fromEntries(
      Object.entries(entry).map(([key, value]) => {
        if (key === "url") return [key, hide(value)];

        if (key === "args" && Array.isArray(value)) return [key, value.map(hide)];

        if (!SECRET_MAPS.has(key) || !isJsonObject(value)) return [key, value];

        return [key, Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hide(v)]))];
      }),
    );

  return {
    servers: Object.fromEntries(servers.map((server) => [server.name, hidden(server.entry)])),
    env,
    tools: servers.map((server) => claudeServerTools(server.name)),
  };
}
