import { describe, expect } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Context, Effect, FileSystem, Layer, Option, type Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { refuse } from "../src/core/approval.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
import {
  type McpServersStatus,
  approvedClaudeServers,
  decideMcpPlugin,
  decideMcpServer,
  mcpNotices,
  mcpServersStatus,
} from "../src/core/mcpApprovals.ts";
import type { AgentName } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { pluginFolder, setUpClaudePlugins, writeFiles } from "./pluginFixtures.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

class AgentHome extends Context.Service<
  AgentHome,
  {
    /** Where the user's agents keep their config: Claude Code's `.claude.json` and Codex's `config.toml`. */
    readonly config: string;
    /** Where the app keeps its records. */
    readonly appDir: string;
  }
>()("test/AgentHome") {}

/** The user's agent config and the app's folder, which the fake agents and the core look in. */
const agentHome = Layer.unwrap(
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const fakes = yield* FakeAgentDir;
    const config = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-agent-config-" });
    const appDir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-" });
    const env = { PATH: join(fakes.dir, "bin"), CLAUDE_CONFIG_DIR: config, CODEX_HOME: config };

    return Layer.mergeAll(
      Layer.succeed(AgentHome, { config, appDir }),
      Layer.succeed(AppData, Option.some(appDir)),
      ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
    );
  }),
).pipe(Layer.orDie);

const it = testEffect(
  agentHome.pipe(Layer.provideMerge(Layer.merge(tempWorkspace("Servers"), fakeAgents))),
);

const writeConfig = (file: string, text: string) =>
  Effect.gen(function* () {
    const { config } = yield* AgentHome;
    const fs = yield* FileSystem.FileSystem;

    yield* Effect.orDie(fs.writeFileString(join(config, file), text));
  });

const setUpClaude = (record: Schema.JsonObject) =>
  writeConfig(".claude.json", JSON.stringify(record));

const stateOf = (status: McpServersStatus, name: string) =>
  status.servers.find((server) => server.name === name)?.state;

/** The app's record of what the user turned on, as it is on disk. */
const savedFile = (file: string) =>
  Effect.gen(function* () {
    const { appDir } = yield* AgentHome;
    const fs = yield* FileSystem.FileSystem;

    return JSON.parse(yield* Effect.orDie(fs.readFileString(join(appDir, file))));
  });

/** Turn `name` on or off as the user sees it now. */
const decide = Effect.fnUntraced(function* (agent: AgentName, name: string, on: boolean) {
  const status = yield* mcpServersStatus();
  const server = status.servers.find((one) => one.agent === agent && one.name === name);

  return yield* decideMcpServer({ agent, name, fingerprint: server?.fingerprint ?? "", on });
});

const DOCS = { command: "docs-mcp", env: { TOKEN: "t-1" } };

/** A Claude Code the user has set up with a server of their own and one for this workspace. */
const userServers = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const ws = yield* Workspace;

  yield* fakes.bin("claude", "");
  yield* setUpClaude({
    mcpServers: { docs: DOCS },
    projects: { [ws.root]: { mcpServers: { notes: { command: "notes-mcp" } } } },
  });
});

describe("the MCP servers the user set up", () => {
  it.live("are off for runs until the user turns them on, as they saw them", () =>
    Effect.gen(function* () {
      yield* userServers;

      const status = yield* mcpServersStatus();

      expect(status.servers.map((server) => [server.name, server.source, server.state])).toEqual([
        ["docs", "user", "new"],
        ["notes", "local", "new"],
      ]);
      expect((yield* approvedClaudeServers()).servers).toEqual({});

      const unseen = yield* Effect.flip(
        decideMcpServer({ agent: "claude", name: "docs", fingerprint: "x", on: true }),
      );

      expect(unseen._tag).toBe("Conflict");
      expect((yield* decide("claude", "docs", true)).state).toBe("on");
      expect((yield* decide("claude", "notes", false)).state).toBe("off");

      const approved = yield* approvedClaudeServers();

      expect(Object.keys(approved.servers)).toEqual(["docs"]);
    }),
  );

  it.live("keep the user's own once for every workspace, and this folder's by its root", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* userServers;
      yield* decide("claude", "docs", true);
      yield* decide("claude", "notes", false);

      const saved = yield* savedFile("mcp-servers.json");

      expect(saved.user.claude.docs).toEqual({ on: true, fingerprint: expect.any(String) });
      expect(saved.workspaces[ws.root].claude.notes).toEqual({
        on: false,
        fingerprint: expect.any(String),
      });
    }),
  );

  it.live("are asked about again when how they start changes, but not for a new key", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* userServers;
      yield* decide("claude", "docs", true);
      yield* decide("claude", "notes", false);

      yield* setUpClaude({
        mcpServers: { docs: { ...DOCS, env: { TOKEN: "t-2" } } },
        projects: {
          [ws.root]: { mcpServers: { notes: { command: "notes-mcp", args: ["--all"] } } },
        },
      });

      const rotated = yield* mcpServersStatus();

      expect(stateOf(rotated, "docs")).toBe("on");
      // Off stays off, whatever it starts.
      expect(stateOf(rotated, "notes")).toBe("off");

      yield* setUpClaude({ mcpServers: { docs: { ...DOCS, command: "other-mcp" } } });

      expect(stateOf(yield* mcpServersStatus(), "docs")).toBe("changed");
      expect((yield* approvedClaudeServers()).servers).toEqual({});
      expect(yield* mcpNotices()).toEqual([
        expect.stringContaining("docs (Claude Code, changed since turned on)"),
      ]);
    }),
  );

  it.live("are told to the agent while they wait for the user", () =>
    Effect.gen(function* () {
      yield* userServers;

      const [notice] = yield* mcpNotices();

      expect(notice).toContain("docs (Claude Code, new), notes (Claude Code, new)");

      yield* decide("claude", "docs", true);
      yield* decide("claude", "notes", false);

      expect(yield* mcpNotices()).toEqual([]);
    }),
  );

  it.live("keep every other record in the file as it was", () =>
    Effect.gen(function* () {
      const { appDir } = yield* AgentHome;
      const fs = yield* FileSystem.FileSystem;

      yield* userServers;
      yield* fs.writeFileString(
        join(appDir, "mcp-servers.json"),
        JSON.stringify({ user: { codex: { web: { on: true } } }, later: 1 }),
      );
      yield* decide("claude", "docs", true);

      const saved = yield* savedFile("mcp-servers.json");

      expect(saved.user.codex).toEqual({ web: { on: true } });
      expect(saved.later).toBe(1);
    }),
  );

  it.live("can't be turned on when they aren't there, or with nowhere to keep it", () =>
    Effect.gen(function* () {
      yield* userServers;

      const gone = yield* Effect.flip(
        decideMcpServer({ agent: "claude", name: "gone", fingerprint: "x", on: true }),
      );

      expect(gone._tag).toBe("NotFound");

      const { fingerprint = "" } = (yield* mcpServersStatus()).servers[0] ?? {};

      const error = yield* Effect.flip(
        decideMcpServer({ agent: "claude", name: "docs", fingerprint, on: true }),
      ).pipe(Effect.provideService(AppData, Option.none()));

      expect(error._tag).toBe("InvalidRequest");
    }),
  );
});

it.live("an agent the user doesn't have shows none of its servers", () =>
  Effect.gen(function* () {
    yield* setUpClaude({ mcpServers: { docs: DOCS } });
    yield* writeConfig("config.toml", '[mcp_servers.web]\nurl = "https://x"\n');

    expect(yield* mcpServersStatus()).toEqual({ servers: [], plugins: [], problems: [] });
    expect(yield* mcpNotices()).toEqual([]);
  }),
);

it.live("Codex's servers are told to the agent from its config, without starting Codex", () =>
  Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const fs = yield* FileSystem.FileSystem;
    const started = join(fakes.calls, "started");

    yield* fakes.bin("codex", `touch "${started}"\n`);
    yield* writeConfig("config.toml", '[mcp_servers.web]\nurl = "https://x"\n');

    expect(yield* mcpNotices()).toEqual([expect.stringContaining("web (Codex, new)")]);
    expect(yield* fs.exists(started)).toBe(false);
  }),
);

/** What the fake agent was given, one argument at a time. */
const given = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const fs = yield* FileSystem.FileSystem;

  return (yield* Effect.orDie(fs.readFileString(join(fakes.calls, "args")))).split("\0");
});

const edit = (agent: AgentName) =>
  Effect.gen(function* () {
    const created = yield* createItem({ title: "Clip" });
    const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });

    yield* runEdit(undefined)(
      { itemId: created.id, feedbackId: feedback.id, agent },
      () => Effect.void,
      refuse,
    );
  });

/** A fake Codex that lists `servers` as its MCP servers and keeps the arguments of its app-server. */
const codexListing = (servers: Schema.Json) =>
  Effect.flatMap(FakeAgentDir, (fakes) =>
    fakes.bin(
      "codex",
      `[ "$1" = mcp ] && { echo '${JSON.stringify(servers)}'; exit 0; }
[ "$1" = app-server ] || exit 0
printf '%s\\0' "$@" > "${fakes.calls}/args"
`,
    ),
  );

describe("an edit run", () => {
  it.live(
    "of Claude loads the servers the user turned on, their secrets off the command line",
    () =>
      Effect.gen(function* () {
        const fakes = yield* FakeAgentDir;
        const fs = yield* FileSystem.FileSystem;

        yield* fakes.bin(
          "claude",
          `head -n 1 >/dev/null
printf '%s\\0' "$@" > "${fakes.calls}/args"
env | grep '^CUTFAC_MCP_SECRET_' > "${fakes.calls}/env"
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
        );
        yield* setUpClaude({ mcpServers: { docs: DOCS, notes: { command: "notes-mcp" } } });
        yield* decide("claude", "docs", true);
        yield* edit("claude");

        const argv = yield* given;
        const mcpConfig = JSON.parse(argv[argv.indexOf("--mcp-config") + 1] ?? "{}");

        expect(mcpConfig.mcpServers).toEqual({
          docs: { command: "docs-mcp", env: { TOKEN: "${CUTFAC_MCP_SECRET_0}" } },
        });
        expect(argv.join(" ")).not.toContain("t-1");
        expect(yield* fs.readFileString(join(fakes.calls, "env"))).toBe(
          "CUTFAC_MCP_SECRET_0=t-1\n",
        );

        // Claude asks the board before it uses their tools, as it would ask in a terminal.
        const allowed = (argv[argv.indexOf("--allowedTools") + 1] ?? "").split(",");

        for (const tool of allowed) expect(tool).toStartWith("mcp__cutfac__");
      }),
  );

  it.live("of Codex keeps the servers the user turned on and switches off the rest", () =>
    Effect.gen(function* () {
      yield* codexListing([
        { name: "docs", enabled: true, transport: { type: "stdio", command: "docs-mcp" } },
        { name: "web", enabled: true, transport: { type: "streamable_http", url: "https://x" } },
      ]);
      yield* decide("codex", "docs", true);
      yield* edit("codex");

      const argv = yield* given;

      expect(argv).toContain("mcp_servers.web.enabled=false");
      expect(argv).toContain('mcp_servers.web.url="http://127.0.0.1:9"');
      expect(argv).not.toContain("mcp_servers.docs.enabled=false");
    }),
  );
});

/** Turn the plugin `id` on or off as the user sees it now. */
const decidePlugin = Effect.fnUntraced(function* (agent: AgentName, id: string, on: boolean) {
  const status = yield* mcpServersStatus();
  const plugin = status.plugins.find((one) => one.agent === agent && one.id === id);

  return yield* decideMcpPlugin({ agent, id, fingerprint: plugin?.fingerprint ?? "", on });
});

const DOCS_PLUGIN = {
  ".claude-plugin/plugin.json": { name: "docs", description: "Search the docs" },
  ".mcp.json": { mcpServers: { search: { command: "${CLAUDE_PLUGIN_ROOT}/bin/search" } } },
};

/** A Claude Code the user has set up with the docs plugin, turned on in their settings. */
const docsPlugin = Effect.gen(function* () {
  const { config } = yield* AgentHome;
  const fakes = yield* FakeAgentDir;

  yield* fakes.bin("claude", "");
  yield* setUpClaudePlugins(
    config,
    { "docs@market": { files: DOCS_PLUGIN } },
    { "docs@market": true },
  );
});

describe("a plugin with MCP servers", () => {
  it.live("is asked about once for all of its servers, which stay off until the user says", () =>
    Effect.gen(function* () {
      const { config } = yield* AgentHome;

      yield* docsPlugin;

      const [plugin] = (yield* mcpServersStatus()).plugins;

      expect(plugin).toMatchObject({
        agent: "claude",
        id: "docs@market",
        title: "docs",
        description: "Search the docs",
        state: "new",
        // Where the plugin is, filled in.
        servers: [{ name: "search", launch: `${pluginFolder(config, "docs@market")}/bin/search` }],
      });
      expect((yield* approvedClaudeServers()).servers).toEqual({});

      const [notice] = yield* mcpNotices();

      expect(notice).toContain("the docs plugin's servers (Claude Code, new)");
      expect(notice).toContain("ask the user to turn it on there");
      expect(notice).toContain("Plugins' skills load either way.");

      expect((yield* decidePlugin("claude", "docs@market", true)).state).toBe("on");
      expect(yield* mcpNotices()).toEqual([]);

      const saved = yield* savedFile("mcp-servers.json");

      expect(saved.plugins.claude["docs@market"]).toEqual({
        on: true,
        fingerprint: plugin?.fingerprint,
      });
    }),
  );

  it.live("once on, loads in Claude's runs as Claude Code names it, where the plugin is", () =>
    Effect.gen(function* () {
      const { config } = yield* AgentHome;

      yield* docsPlugin;
      yield* decidePlugin("claude", "docs@market", true);

      const approved = yield* approvedClaudeServers();
      const root = pluginFolder(config, "docs@market");

      expect(approved.servers["plugin:docs:search"]).toMatchObject({
        command: `${root}/bin/search`,
      });
      expect(Object.values(approved.env)).toContain(root);
    }),
  );

  it.live("is asked about again when what it starts changes, and not turned on unseen", () =>
    Effect.gen(function* () {
      const { config } = yield* AgentHome;

      yield* docsPlugin;

      const [seen] = (yield* mcpServersStatus()).plugins;

      yield* decidePlugin("claude", "docs@market", true);
      yield* writeFiles(pluginFolder(config, "docs@market"), {
        ".mcp.json": { mcpServers: { search: { command: "other" } } },
      });

      expect((yield* mcpServersStatus()).plugins[0]?.state).toBe("changed");
      expect((yield* approvedClaudeServers()).servers).toEqual({});

      const decision = { agent: "claude", id: "docs@market", on: true } as const;

      const stale = yield* Effect.flip(
        decideMcpPlugin({ ...decision, fingerprint: seen?.fingerprint ?? "" }),
      );

      expect(stale._tag).toBe("Conflict");

      const gone = yield* Effect.flip(
        decideMcpPlugin({ ...decision, id: "gone@market", fingerprint: "" }),
      );

      expect(gone._tag).toBe("NotFound");
    }),
  );
});

it.live("Codex's runs keep the servers of a plugin the user turned on, offered as the plugin", () =>
  Effect.gen(function* () {
    const { config } = yield* AgentHome;

    yield* codexListing([
      { name: "notes", enabled: true, transport: { type: "stdio", command: "notes-mcp" } },
      { name: "web", enabled: true, transport: { type: "streamable_http", url: "https://x" } },
    ]);

    yield* writeFiles(config, {
      "config.toml":
        '[mcp_servers.web]\nurl = "https://x"\n\n[plugins."notes@local"]\nenabled = true\n',
    });
    yield* writeFiles(pluginFolder(config, "notes@local"), {
      ".mcp.json": { mcpServers: { notes: { command: "notes-mcp" } } },
    });

    const status = yield* mcpServersStatus();

    expect(status.servers.map((server) => server.name)).toEqual(["web"]);
    expect(status.plugins.map((plugin) => plugin.id)).toEqual(["notes@local"]);

    yield* decidePlugin("codex", "notes@local", true);
    yield* edit("codex");

    const argv = yield* given;

    expect(argv).toContain("mcp_servers.web.enabled=false");
    expect(argv).not.toContain("mcp_servers.notes.enabled=false");
  }),
);
