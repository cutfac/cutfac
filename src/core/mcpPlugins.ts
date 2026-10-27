import { Effect, Option, Path, Predicate, Result, Schema } from "effect";
import { Base64 } from "effect/encoding";

import { claudeConfigDir, codexHome } from "./agents.ts";
import { byName, canonicalJson, isJsonObject, lenient } from "./json.ts";
import { readOptionalText } from "./library.ts";
import {
  type McpServer,
  decodeJsonObject,
  entriesIn,
  entrySetup,
  isCutfacServer,
  tomlTables,
  peekConfig,
} from "./mcpServers.ts";
import type { AgentName } from "./schema.ts";
import { sha256 } from "./skill.ts";
import { Workspace } from "./workspace.ts";
import { SETTINGS_FILES } from "./workspaceTrust.ts";

/**
 * A plugin of the user's agent that brings MCP servers, which the user turns on or off as one. Its
 * skills load either way; only its servers wait for the user.
 */
export interface McpPlugin {
  readonly agent: AgentName;
  /** As the agent names it: `name@marketplace`. */
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  /** The plugin's own picture, a file in its folder. */
  readonly logoFile?: string | undefined;
  /** Its servers as the plugin sets them up, before the agent fills in where the plugin is. */
  readonly servers: ReadonlyArray<McpServer>;
  /** What the agent fills in for the plugin's `${…}` variables. */
  readonly vars: Readonly<Record<string, string>>;
}

/** A file outside the workspace as a JSON object, or none while it is missing or isn't one. */
const peekObject = (full: string) => Effect.map(peekConfig(full), Option.flatMap(decodeJsonObject));

/** The first of `files` that `read` finds a JSON object in. */
const firstObject = <E, R>(
  files: ReadonlyArray<string>,
  read: (file: string) => Effect.Effect<Option.Option<Schema.JsonObject>, E, R>,
) =>
  Effect.findFirstFilter(files, (file) =>
    Effect.map(
      read(file),
      Result.fromOption(() => file),
    ),
  );

/** `rel` in the plugin folder `root`, or none when it points out of it. */
function inside(path: Path.Path, root: string, rel: string) {
  const full = path.resolve(root, rel);
  const back = path.relative(root, full);

  return back === "" || back.startsWith("..") || path.isAbsolute(back)
    ? Option.none()
    : Option.some(full);
}

const Text = lenient(Schema.String);

const decodeServerFile = Schema.decodeUnknownOption(
  Schema.Struct({ mcpServers: lenient(Schema.JsonObject) }),
);

const serversIn = (config: Schema.JsonObject) =>
  entriesIn(Option.getOrUndefined(decodeServerFile(config))?.mcpServers ?? config);

const decodeText = Schema.decodeUnknownOption(Schema.String);

const decodeObject = Schema.decodeUnknownOption(Schema.JsonObject);

const Manifest = Schema.Struct({
  name: Text,
  description: Text,
  mcpServers: Schema.optionalKey(Schema.Json),
  interface: lenient(Schema.Struct({ displayName: Text, shortDescription: Text, logo: Text })),
});

type Manifest = typeof Manifest.Type;

const decodeManifest = Schema.decodeUnknownOption(Manifest);

const manifestOf = <E, R>(found: Effect.Effect<Option.Option<Schema.JsonObject>, E, R>) =>
  Effect.map(found, (manifest) =>
    Option.getOrElse(Option.flatMap(manifest, decodeManifest), (): Manifest => ({})),
  );

/**
 * The servers `spec`, a manifest's `mcpServers`, sets up in the plugin at `root`: files in it or
 * the servers themselves. Without one, the first of `defaults` there. Later ones win a name.
 */
const pluginEntries = Effect.fnUntraced(function* (
  root: string,
  spec: Schema.Json | undefined,
  defaults: ReadonlyArray<string>,
) {
  const path = yield* Path.Path;

  const read = (rel: string) =>
    Option.match(inside(path, root, rel), { onNone: () => Effect.succeedNone, onSome: peekObject });

  const configs =
    spec === undefined
      ? Option.toArray(yield* firstObject(defaults, read))
      : yield* Effect.forEach(Array.isArray(spec) ? spec : [spec], (one) =>
          Option.match(decodeText(one), {
            onSome: read,
            onNone: () => Effect.succeed(decodeObject(one)),
          }),
        ).pipe(Effect.map((found) => found.flatMap(Option.toArray)));

  return [...new Map(configs.flatMap(serversIn).map((one) => [one.name, one])).values()];
});

/** `name@marketplace` split, its name first. */
const idParts = (id: string) => {
  const at = id.lastIndexOf("@");

  return at <= 0 ? [id, ""] : [id.slice(0, at), id.slice(at + 1)];
};

// ---------------------------------------------------------------------------------------------
// Claude Code

const InstalledPlugins = Schema.Struct({
  plugins: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        installPath: Schema.String,
        projectPath: Schema.optionalKey(Schema.String),
      }),
    ),
  ),
});

const decodeInstalled = Schema.decodeUnknownOption(Schema.fromJsonString(InstalledPlugins));

const decodeSwitches = Schema.decodeUnknownOption(
  Schema.Struct({ enabledPlugins: lenient(Schema.Record(Schema.String, Schema.Json)) }),
);

const decodeSwitch = Schema.decodeUnknownOption(Schema.Boolean);

/** The plugins `settings` turns on or off, by id. */
function enabledIn(settings: Option.Option<Schema.JsonObject>) {
  const enabled = Option.getOrUndefined(Option.flatMap(settings, decodeSwitches))?.enabledPlugins;

  return Object.entries(enabled ?? {}).flatMap(([id, value]) =>
    Option.toArray(Option.map(decodeSwitch(value), (on) => [id, on] as const)),
  );
}

/** Claude Code names a plugin's data folder after its id, with only these characters kept. */
const dataFolder = (id: string) => id.replaceAll(/[^a-zA-Z0-9\-_]/g, "-");

/** A value Claude Code would ask the user for when they turn the plugin on, which a run can't. */
const asksTheUser = (entry: Schema.JsonObject) => JSON.stringify(entry).includes("${user_config.");

/**
 * The plugins Claude Code has on here that bring MCP servers: turned on in the user's settings or
 * the workspace's, which win in that order as in Claude Code, and installed for every folder or
 * for this one.
 */
export const claudePlugins = Effect.fn("mcpPlugins.claude")(function* () {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const dir = yield* claudeConfigDir;

  if (Option.isNone(dir)) return [];

  const workspaceSettings = yield* Effect.forEach(SETTINGS_FILES, (file) =>
    readOptionalText(file).pipe(
      Effect.map((text) => (text === undefined ? Option.none() : decodeJsonObject(text))),
      Effect.orElseSucceed(Option.none),
    ),
  );

  const settings = [yield* peekObject(path.join(dir.value, "settings.json")), ...workspaceSettings];
  const enabled = new Map(settings.flatMap(enabledIn));

  const installedText = yield* peekConfig(
    path.join(dir.value, "plugins", "installed_plugins.json"),
  );

  const installed = Option.getOrUndefined(Option.flatMap(installedText, decodeInstalled));

  const plugins = yield* Effect.forEach([...enabled].toSorted(byName(([id]) => id)), ([id, on]) =>
    Effect.gen(function* () {
      const installs = installed?.plugins[id] ?? [];

      const install =
        installs.find((one) => one.projectPath === ws.root) ??
        installs.find((one) => one.projectPath === undefined);

      if (!on || install === undefined) return [];

      const root = install.installPath;

      const manifest = yield* manifestOf(
        peekObject(path.join(root, ".claude-plugin", "plugin.json")),
      );

      const entries = yield* pluginEntries(root, manifest.mcpServers, [".mcp.json"]);

      const servers = entries.flatMap(({ name, entry }): ReadonlyArray<McpServer> =>
        isCutfacServer(name) || asksTheUser(entry)
          ? []
          : [{ agent: "claude", name, source: "user", entry }],
      );

      if (servers.length === 0) return [];
      const [name] = idParts(id);

      const plugin: McpPlugin = {
        agent: "claude",
        id,
        title: manifest.name ?? name ?? id,
        description: manifest.description,
        servers,
        vars: {
          CLAUDE_PLUGIN_ROOT: root,
          CLAUDE_PLUGIN_DATA: path.join(dir.value, "plugins", "data", dataFolder(id)),
        },
      };

      return [plugin];
    }),
  );

  return plugins.flat();
});

/** `value` with the plugin's `${…}` variables filled in, as Claude Code does in every string. */
function filled(value: Schema.Json, vars: Readonly<Record<string, string>>): Schema.Json {
  if (Predicate.isString(value)) {
    return Object.entries(vars).reduce(
      (text, [name, to]) => text.replaceAll(`\${${name}}`, to),
      value,
    );
  }

  if (Array.isArray(value)) return value.map((one) => filled(one, vars));

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(Object.entries(value).map(([key, one]) => [key, filled(one, vars)]));
}

/** `plugin`'s servers with where it is filled in, as the agent starts them. */
export const filledServers = (plugin: McpPlugin): ReadonlyArray<McpServer> =>
  plugin.servers.map((server) => {
    const entry = filled(server.entry, plugin.vars);

    return { ...server, entry: isJsonObject(entry) ? entry : {} };
  });

/**
 * `plugin`'s servers as Claude Code loads them: named for the plugin, with where it is filled in,
 * and, for a server it starts, given too as variables, as Claude Code does.
 */
export function claudePluginRunServers(plugin: McpPlugin): ReadonlyArray<McpServer> {
  const [name] = idParts(plugin.id);

  return filledServers(plugin).map((server) => {
    const { entry } = server;
    const env = isJsonObject(entry["env"]) ? entry["env"] : {};

    return {
      ...server,
      name: `plugin:${name}:${server.name}`,
      entry: "command" in entry ? { ...entry, env: { ...plugin.vars, ...env } } : entry,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Codex

/**
 * Codex loads no MCP servers from the plugins of its own curated marketplace, which reach their
 * services through apps instead, so they are not offered. Should it start to, their servers show
 * up in its list and are offered one by one.
 */
const APPS_MARKETPLACE = "openai-curated";

/** Where a Codex plugin keeps its manifest, the first of these it has. */
const CODEX_MANIFESTS = [".codex-plugin/plugin.json", ".claude-plugin/plugin.json", "plugin.json"];

/** The server files a Codex plugin without its own list has, the first of these it has. */
const CODEX_SERVER_FILES = [".mcp.json", "mcp.json"];

const byVersion = new Intl.Collator("en", { numeric: true }).compare;

/** The folder of the version of a plugin Codex loads: the one it marks `latest`, or the newest. */
const codexPluginRoot = Effect.fnUntraced(function* (folder: string) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const found = yield* ws.peek(folder).pipe(Effect.orElseSucceed(() => ({ dir: false }) as const));

  if (!found.dir) return Option.none();

  const version = found.names.includes("latest")
    ? "latest"
    : found.names.toSorted(byVersion).at(-1);

  return Option.map(Option.fromNullishOr(version), (one) => path.join(folder, one));
});

/**
 * The plugins Codex has on that bring MCP servers, by its `config.toml`. A server the config sets
 * up too is the config's, and offered on its own.
 */
export const codexPlugins = Effect.fn("mcpPlugins.codex")(function* () {
  const path = yield* Path.Path;
  const home = yield* codexHome;

  if (Option.isNone(home)) return [];
  const text = yield* peekConfig(path.join(home.value, "config.toml"));
  const config = Option.getOrElse(text, () => "");
  const configured = new Set(tomlTables(config, "mcp_servers").map(([name]) => name));

  const plugins = yield* Effect.forEach(
    tomlTables(config, "plugins").toSorted(byName(([id]) => id)),
    ([id, settings]) =>
      Effect.gen(function* () {
        const [name = id, market = ""] = idParts(id);
        const off = settings["enabled"] === false;

        if (off || market === APPS_MARKETPLACE) return [];

        const root = yield* codexPluginRoot(
          path.join(home.value, "plugins", "cache", market, name),
        );

        if (Option.isNone(root)) return [];

        const manifest = yield* manifestOf(
          firstObject(CODEX_MANIFESTS, (file) => peekObject(path.join(root.value, file))),
        );

        const entries = yield* pluginEntries(root.value, manifest.mcpServers, CODEX_SERVER_FILES);

        const servers = entries.flatMap(({ name: server, entry }): ReadonlyArray<McpServer> =>
          entry["enabled"] === false || configured.has(server) || isCutfacServer(server)
            ? []
            : [{ agent: "codex", name: server, source: "user", entry }],
        );

        if (servers.length === 0) return [];

        const shown = manifest.interface ?? {};

        const plugin: McpPlugin = {
          agent: "codex",
          id,
          title: shown.displayName ?? manifest.name ?? name,
          description: shown.shortDescription ?? manifest.description,
          logoFile:
            shown.logo === undefined
              ? undefined
              : Option.getOrUndefined(inside(path, root.value, shown.logo)),
          servers,
          vars: {},
        };

        return [plugin];
      }),
  );

  return plugins.flat();
});

// ---------------------------------------------------------------------------------------------
// Both

/** A name for exactly what `plugin`'s servers start, so a change since the user turned it on is asked again. */
export const pluginFingerprint = (plugin: McpPlugin) =>
  sha256(
    JSON.stringify(
      canonicalJson(
        Object.fromEntries(plugin.servers.map((server) => [server.name, entrySetup(server.entry)])),
      ),
    ),
  );

/** Enough for a plugin's picture; a bigger file is left out. */
const LOGO_BYTES = 256 * 1024;

const LOGO_TYPES = new Map([
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
]);

/** The picture in `file` as a `data:` address the board can show, or none when it can't be. */
export const pluginLogo = Effect.fnUntraced(function* (file: string) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const type = LOGO_TYPES.get(path.extname(file).toLowerCase());

  if (type === undefined) return undefined;
  const bytes = yield* Effect.option(ws.peekBytes(file, LOGO_BYTES + 1));

  if (Option.isNone(bytes) || bytes.value.length > LOGO_BYTES) return undefined;

  return `data:${type};base64,${Base64.encode(bytes.value)}`;
});
