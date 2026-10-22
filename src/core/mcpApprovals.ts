import { Effect, Option, Schema } from "effect";

import { AGENT_TITLE } from "./agentVersion.ts";
import { peekAppStore, updateAppStore } from "./appStore.ts";
import { Conflict, NotFound } from "./errors.ts";
import { isJsonObject } from "./json.ts";
import {
  type CodexListed,
  type FoundServers,
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

export interface McpServersStatus {
  readonly servers: ReadonlyArray<McpServerView>;
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

const Choice = Schema.Struct({ on: Schema.Boolean, fingerprint: Schema.String });

const decodeChoice = Schema.decodeUnknownOption(Choice);

/** Where the choice for `server` is kept: once for the user's own servers, else by workspace. */
const choicePath = (root: string, server: McpServer) =>
  server.source === "user"
    ? ["user", server.agent, server.name]
    : ["workspaces", root, server.agent, server.name];

const at = (store: Schema.Json, path: ReadonlyArray<string>) =>
  path.reduce<Schema.Json | undefined>(
    (value, key) => (isJsonObject(value) ? value[key] : undefined),
    store,
  );

/** `store` with `value` at `path`, keeping everything else as it was. */
function setAt(
  store: Schema.JsonObject,
  [key, ...rest]: ReadonlyArray<string>,
  value: Schema.Json,
): Schema.JsonObject {
  if (key === undefined) return store;
  const inner = store[key];

  return {
    ...store,
    [key]: rest.length === 0 ? value : setAt(isJsonObject(inner) ? inner : {}, rest, value),
  };
}

function stateOf(choice: Schema.Json | undefined, fingerprint: string): McpState {
  const found = decodeChoice(choice);

  if (Option.isNone(found)) return "new";

  if (!found.value.on) return "off";

  return found.value.fingerprint === fingerprint ? "on" : "changed";
}

interface Judged {
  readonly server: McpServer;
  readonly fingerprint: string;
  readonly state: McpState;
}

/** `servers` with whether each is on, by the user's choices. */
const judged = Effect.fnUntraced(function* (servers: ReadonlyArray<McpServer>) {
  const ws = yield* Workspace;
  const store = yield* peekAppStore(STORE_FILE);

  return yield* Effect.forEach(servers, (server) =>
    Effect.map(serverFingerprint(server), (fingerprint): Judged => ({
      server,
      fingerprint,
      state: stateOf(at(store, choicePath(ws.root, server)), fingerprint),
    })),
  );
});

const NONE: FoundServers = { servers: [], problems: [] };

/** `found` where `agent` is installed, so an agent the user doesn't have shows nothing. */
const ifInstalled = <E, R>(
  agent: AgentName,
  found: (bin: string) => Effect.Effect<FoundServers, E, R>,
) =>
  Effect.flatMap(which(agent), Option.match({ onNone: () => Effect.succeed(NONE), onSome: found }));

/** Codex's servers by its own list, which is slow; when Codex can't give it, why. */
const listedCodexServers = (bin: string) =>
  codexServers(bin).pipe(
    Effect.map((listed): FoundServers => ({ servers: codexCandidates(listed), problems: [] })),
    Effect.catch((error) => Effect.succeed({ servers: [], problems: [error.message] })),
  );

/** Every server the user could turn on here for `agent`. */
const serversOf = (agent: AgentName) =>
  agent === "claude"
    ? ifInstalled("claude", () => claudeServers())
    : ifInstalled("codex", listedCodexServers);

const viewOf = ({ server, fingerprint, state }: Judged): McpServerView => ({
  agent: server.agent,
  name: server.name,
  source: server.source,
  state,
  fingerprint,
  ...launchView(server),
});

/** The MCP servers the user set up for their agents, and which of them runs from the board use. */
export const mcpServersStatus = Effect.fn("mcpApprovals.status")(function* () {
  const found = yield* Effect.all([serversOf("claude"), serversOf("codex")], {
    concurrency: "unbounded",
  });

  const servers = yield* judged(found.flatMap((one) => one.servers));

  return {
    servers: servers.map(viewOf),
    problems: found.flatMap((one) => one.problems),
  } satisfies McpServersStatus;
});

/**
 * Turn a server on or off for runs from the board, as the user saw it, and how it is now. One that
 * changed since is not turned on; the user looks it over again.
 */
export const decideMcpServer = Effect.fn("mcpApprovals.decide")(function* (decision: McpDecision) {
  const ws = yield* Workspace;
  const { agent, name, fingerprint, on } = decision;
  const server = (yield* serversOf(agent)).servers.find((one) => one.name === name);

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

  return viewOf({ server, fingerprint, state: on ? "on" : "off" });
});

/** The servers waiting for the user, read without starting Codex, as workspace_overview says. */
export const mcpNotices = Effect.fn("mcpApprovals.notices")(function* () {
  const [claude, codex] = yield* Effect.all(
    [
      ifInstalled("claude", () => claudeServers()),
      ifInstalled("codex", () =>
        Effect.map(codexConfigServers(), (servers): FoundServers => ({ servers, problems: [] })),
      ),
    ],
    { concurrency: "unbounded" },
  );

  const waiting = (yield* judged([...claude.servers, ...codex.servers])).flatMap(
    ({ server, state }) =>
      state === "new" || state === "changed"
        ? [
            `${server.name} (${AGENT_TITLE[server.agent]}, ${state === "new" ? "new" : "changed since turned on"})`,
          ]
        : [],
  );

  if (waiting.length === 0) return [];

  return [
    "MCP servers the user set up are off for runs from the board until the user turns them on, " +
      `or keeps them off, in the board's Setup: ${waiting.join(", ")}.`,
  ];
});

/** The servers the user turned on for Claude, as a run loads them. */
export const approvedClaudeServers = Effect.fn("mcpApprovals.claude")(function* () {
  const found = yield* claudeServers();
  const servers = yield* judged(found.servers);

  return claudeRunServers(servers.flatMap(({ server, state }) => (state === "on" ? [server] : [])));
});

/** The names of the servers in Codex's list `listed` that the user turned on. */
export const approvedCodexServers = Effect.fn("mcpApprovals.codex")(function* (
  listed: ReadonlyArray<CodexListed>,
) {
  const servers = yield* judged(codexCandidates(listed));

  return servers.flatMap(({ server, state }) => (state === "on" ? [server.name] : []));
});
