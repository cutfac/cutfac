import { Effect, Option, Schema } from "effect";

import { envVar } from "./agentConfig.ts";
import { AGENT_TITLE } from "./agentVersion.ts";
import { peekAppStore, updateAppStore } from "./appStore.ts";
import { Conflict, NotFound } from "./errors.ts";
import { isJsonObject, setAt } from "./json.ts";
import {
  type McpPlugin,
  claudePluginRunServers,
  claudePlugins,
  codexPlugins,
  filledServers,
  pluginFingerprint,
  pluginLogo,
} from "./mcpPlugins.ts";
import {
  type CodexListed,
  type McpLaunchView,
  type McpServer,
  type McpSource,
  claudeRunServers,
  claudeServers,
  codexCandidates,
  codexConfigServers,
  codexServers,
  launchView,
  serverFingerprint,
} from "./mcpServers.ts";
import { which } from "./process.ts";
import { AgentName } from "./schema.ts";
import { Workspace } from "./workspace.ts";

/** The app's record of the MCP servers the user turned on, or kept off, for runs from the board. */
const STORE_FILE = "mcp-servers.json";

/**
 * Whether a server is on for runs: off until the user decides, and asked again when how it starts
 * changed since they turned it on.
 */
export type McpState = "on" | "off" | "new" | "changed";

/** A server as the user decides on it. */
export interface McpServerView extends McpLaunchView {
  readonly agent: AgentName;
  readonly name: string;
  readonly source: McpSource;
  readonly state: McpState;
  /** Names how the server starts as the user saw it, so turning it on doesn't agree to a change. */
  readonly fingerprint: string;
}

/** A plugin's servers as the user decides on them, all at once; its skills load either way. */
export interface McpPluginView {
  readonly agent: AgentName;
  /** As the agent names it: `name@marketplace`. */
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
  /** Its picture as a `data:` address, when it has one. */
  readonly logo?: string | undefined;
  readonly state: McpState;
  /** Names what its servers start as the user saw them. */
  readonly fingerprint: string;
  readonly servers: ReadonlyArray<McpLaunchView & { readonly name: string }>;
}

export interface McpServersStatus {
  readonly servers: ReadonlyArray<McpServerView>;
  readonly plugins: ReadonlyArray<McpPluginView>;
  readonly problems: ReadonlyArray<string>;
}

/** The user turning `name`, as `fingerprint` names it, on or off for `agent`'s runs. */
export const McpDecision = Schema.Struct({
  agent: AgentName,
  name: Schema.String,
  fingerprint: Schema.String,
  on: Schema.Boolean,
});

export type McpDecision = typeof McpDecision.Type;

/** The user turning the plugin `id`'s servers, as `fingerprint` names them, on or off. */
export const McpPluginDecision = Schema.Struct({
  agent: AgentName,
  id: Schema.String,
  fingerprint: Schema.String,
  on: Schema.Boolean,
});

export type McpPluginDecision = typeof McpPluginDecision.Type;

const Choice = Schema.Struct({ on: Schema.Boolean, fingerprint: Schema.String });

const decodeChoice = Schema.decodeUnknownOption(Choice);

/** Where the choice for `server` is kept: once for the user's own servers, else by workspace. */
const choicePath = (root: string, server: McpServer) =>
  server.source === "user"
    ? ["user", server.agent, server.name]
    : ["workspaces", root, server.agent, server.name];

/** Where the choice for `plugin` is kept, once for every workspace, as the user installs it. */
const pluginPath = (plugin: McpPlugin) => ["plugins", plugin.agent, plugin.id];

const at = (store: Schema.Json, path: ReadonlyArray<string>) =>
  path.reduce<Schema.Json | undefined>(
    (value, key) => (isJsonObject(value) ? value[key] : undefined),
    store,
  );

function stateOf(choice: Schema.Json | undefined, fingerprint: string): McpState {
  const found = decodeChoice(choice);

  if (Option.isNone(found)) return "new";

  if (!found.value.on) return "off";

  return found.value.fingerprint === fingerprint ? "on" : "changed";
}

interface Judged<A> {
  readonly item: A;
  readonly fingerprint: string;
  readonly state: McpState;
}

/** The servers and plugins the user could turn on for runs here. */
interface Offered {
  readonly servers: ReadonlyArray<McpServer>;
  readonly plugins: ReadonlyArray<McpPlugin>;
  readonly problems: ReadonlyArray<string>;
}

const judge = <A, R>(
  store: Schema.Json,
  item: A,
  path: ReadonlyArray<string>,
  fingerprint: Effect.Effect<string, never, R>,
) =>
  Effect.map(fingerprint, (named): Judged<A> => ({
    item,
    fingerprint: named,
    state: stateOf(at(store, path), named),
  }));

/** `offered` with whether each is on, by the user's choices. */
const judged = Effect.fnUntraced(function* (offered: Omit<Offered, "problems">) {
  const ws = yield* Workspace;
  const store = yield* peekAppStore(STORE_FILE);

  return yield* Effect.all({
    servers: Effect.forEach(offered.servers, (server) =>
      judge(store, server, choicePath(ws.root, server), serverFingerprint(server)),
    ),
    plugins: Effect.forEach(offered.plugins, (plugin) =>
      judge(store, plugin, pluginPath(plugin), pluginFingerprint(plugin)),
    ),
  });
});

const turnedOn = <A>(all: ReadonlyArray<Judged<A>>) =>
  all.flatMap(({ item, state }) => (state === "on" ? [item] : []));

const NONE: Offered = { servers: [], plugins: [], problems: [] };

/** `found` where `agent` is installed, so an agent the user doesn't have shows nothing. */
const ifInstalled = <A, E, R>(
  agent: AgentName,
  none: A,
  found: (bin: string) => Effect.Effect<A, E, R>,
) =>
  Effect.flatMap(which(agent), Option.match({ onNone: () => Effect.succeed(none), onSome: found }));

/**
 * Codex's list split between the plugins whose servers are in it, which the user decides on as
 * one, and the servers on their own.
 */
function codexOffered(listed: ReadonlyArray<CodexListed>, plugins: ReadonlyArray<McpPlugin>) {
  const candidates = codexCandidates(listed);
  const loaded = new Set(candidates.map((server) => server.name));
  const owned = new Set(plugins.flatMap((plugin) => plugin.servers.map((server) => server.name)));

  return {
    servers: candidates.filter((server) => !owned.has(server.name)),
    plugins: plugins.filter((plugin) => plugin.servers.some((server) => loaded.has(server.name))),
  };
}

/** Codex's servers by its own list, which is slow; when Codex can't give it, why. */
const listedCodex = (bin: string) =>
  Effect.all([codexServers(bin), codexPlugins()], { concurrency: "unbounded" }).pipe(
    Effect.map(([listed, plugins]): Offered => ({
      ...codexOffered(listed, plugins),
      problems: [],
    })),
    Effect.catch((error) => Effect.succeed({ ...NONE, problems: [error.message] })),
  );

/** Claude Code's servers and plugins, read from its config as it starts them. */
const claudeOffered = Effect.map(
  Effect.all([claudeServers(), claudePlugins()], { concurrency: "unbounded" }),
  ([found, plugins]): Offered => ({ ...found, plugins }),
);

/** Every server and plugin the user could turn on here for `agent`. */
const offeredBy = (agent: AgentName) =>
  agent === "claude"
    ? ifInstalled("claude", NONE, () => claudeOffered)
    : ifInstalled("codex", NONE, listedCodex);

/** `agent`'s plugins with MCP servers, read without starting it. */
const pluginsOf = (agent: AgentName) =>
  ifInstalled(agent, [], () => (agent === "claude" ? claudePlugins() : codexPlugins()));

/** The user's home folder, which what a server starts is shown from as `~`. */
const homeFolder = Effect.map(envVar("HOME"), Option.getOrUndefined);

const viewOf = Effect.fnUntraced(function* ({
  item: server,
  fingerprint,
  state,
}: Judged<McpServer>) {
  return {
    agent: server.agent,
    name: server.name,
    source: server.source,
    state,
    fingerprint,
    ...launchView(server, yield* homeFolder),
  } satisfies McpServerView;
});

const pluginViewOf = Effect.fnUntraced(function* ({
  item: plugin,
  fingerprint,
  state,
}: Judged<McpPlugin>) {
  const home = yield* homeFolder;

  return {
    agent: plugin.agent,
    id: plugin.id,
    title: plugin.title,
    description: plugin.description,
    logo: plugin.logoFile === undefined ? undefined : yield* pluginLogo(plugin.logoFile),
    state,
    fingerprint,
    // Where the plugin is, filled in, so the user reads what actually runs.
    servers: filledServers(plugin).map((server) => ({
      name: server.name,
      ...launchView(server, home),
    })),
  } satisfies McpPluginView;
});

/** The MCP servers the user set up for their agents, and which of them runs from the board use. */
export const mcpServersStatus = Effect.fn("mcpApprovals.status")(function* () {
  const offered = yield* Effect.all([offeredBy("claude"), offeredBy("codex")], {
    concurrency: "unbounded",
  });

  const { servers, plugins } = yield* judged({
    servers: offered.flatMap((one) => one.servers),
    plugins: offered.flatMap((one) => one.plugins),
  });

  return {
    servers: yield* Effect.forEach(servers, viewOf),
    plugins: yield* Effect.forEach(plugins, pluginViewOf),
    problems: offered.flatMap((one) => one.problems),
  } satisfies McpServersStatus;
});

/**
 * Turn a server on or off for runs from the board, as the user saw it, and how it is now. One that
 * changed since is not turned on; the user looks it over again.
 */
export const decideMcpServer = Effect.fn("mcpApprovals.decide")(function* (decision: McpDecision) {
  const ws = yield* Workspace;
  const { agent, name, fingerprint, on } = decision;
  const server = (yield* offeredBy(agent)).servers.find((one) => one.name === name);

  if (server === undefined) {
    return yield* new NotFound({
      message: `${name} is not among ${AGENT_TITLE[agent]}'s MCP servers here`,
    });
  }

  if ((yield* serverFingerprint(server)) !== fingerprint) {
    return yield* new Conflict({
      message: `How ${name} starts changed; look it over again`,
    });
  }

  yield* updateAppStore(STORE_FILE, "your choices of MCP servers", (store) =>
    setAt(store, choicePath(ws.root, server), { on, fingerprint }),
  );

  return yield* viewOf({ item: server, fingerprint, state: on ? "on" : "off" });
});

/** Turn a plugin's servers on or off for runs from the board, as {@link decideMcpServer} does. */
export const decideMcpPlugin = Effect.fn("mcpApprovals.decidePlugin")(function* (
  decision: McpPluginDecision,
) {
  const { agent, id, fingerprint, on } = decision;
  const plugin = (yield* pluginsOf(agent)).find((one) => one.id === id);

  if (plugin === undefined) {
    return yield* new NotFound({
      message: `${id} is not among ${AGENT_TITLE[agent]}'s plugins with MCP servers`,
    });
  }

  if ((yield* pluginFingerprint(plugin)) !== fingerprint) {
    return yield* new Conflict({
      message: `What ${plugin.title} starts changed; look it over again`,
    });
  }

  yield* updateAppStore(STORE_FILE, "your choices of MCP servers", (store) =>
    setAt(store, pluginPath(plugin), { on, fingerprint }),
  );

  return yield* pluginViewOf({ item: plugin, fingerprint, state: on ? "on" : "off" });
});

const waits = (state: McpState) => state === "new" || state === "changed";

const waitingFor = (agent: AgentName, state: McpState) =>
  `${AGENT_TITLE[agent]}, ${state === "new" ? "new" : "changed since turned on"}`;

/** The servers and plugins waiting for the user, read without starting Codex, which is slow. */
const waitingNow = Effect.fnUntraced(function* () {
  const offered = yield* Effect.all(
    [
      ifInstalled("claude", NONE, () => claudeOffered),
      ifInstalled("codex", NONE, () =>
        Effect.map(
          Effect.all([codexConfigServers(), codexPlugins()], { concurrency: "unbounded" }),
          ([servers, plugins]): Offered => ({ servers, plugins, problems: [] }),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  const { servers, plugins } = yield* judged({
    servers: offered.flatMap((one) => one.servers),
    plugins: offered.flatMap((one) => one.plugins),
  });

  return {
    servers: servers.filter(({ state }) => waits(state)),
    plugins: plugins.filter(({ state }) => waits(state)),
  };
});

/** The servers waiting for the user, as workspace_overview says. */
export const mcpNotices = Effect.fn("mcpApprovals.notices")(function* () {
  const { servers, plugins } = yield* waitingNow();

  const waitingServers = servers.map(
    ({ item, state }) => `${item.name} (${waitingFor(item.agent, state)})`,
  );

  const waitingPlugins = plugins.map(
    ({ item, state }) => `the ${item.title} plugin's servers (${waitingFor(item.agent, state)})`,
  );

  const waiting = [...waitingServers, ...waitingPlugins];

  if (waiting.length === 0) return [];

  return [
    "MCP servers the user set up are off for runs from the board until the user turns them on, " +
      `or keeps them off, in the board's Setup: ${waiting.join(", ")}. ` +
      "When a task needs one of them, ask the user to turn it on there; you can't turn it on yourself." +
      (waitingPlugins.length === 0 ? "" : " Plugins' skills load either way."),
  ];
});

/** The servers the user turned on for Claude, their own and their plugins', as a run loads them. */
export const approvedClaudeServers = Effect.fn("mcpApprovals.claude")(function* () {
  const judgedNow = yield* judged(yield* claudeOffered);

  return claudeRunServers([
    ...turnedOn(judgedNow.servers),
    ...turnedOn(judgedNow.plugins).flatMap(claudePluginRunServers),
  ]);
});

/** The names of the servers in Codex's list `listed` that the user turned on, alone or by plugin. */
export const approvedCodexServers = Effect.fn("mcpApprovals.codex")(function* (
  listed: ReadonlyArray<CodexListed>,
) {
  const { servers, plugins } = yield* judged(codexOffered(listed, yield* codexPlugins()));

  return [
    ...turnedOn(servers).map((server) => server.name),
    ...turnedOn(plugins).flatMap((plugin) => plugin.servers.map((server) => server.name)),
  ];
});
