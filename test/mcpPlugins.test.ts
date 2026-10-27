import { describe, expect } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Effect, FileSystem } from "effect";

import {
  type McpPlugin,
  claudePluginRunServers,
  claudePlugins,
  codexPlugins,
  pluginFingerprint,
  pluginLogo,
} from "../src/core/mcpPlugins.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { pluginFolder, setUpClaudePlugins, writeFiles } from "./pluginFixtures.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("Plugins"));

const pluginsSetup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const ws = yield* Workspace;
  const config = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-agent-config-" });

  const env = ConfigProvider.fromEnv({ env: { CLAUDE_CONFIG_DIR: config, CODEX_HOME: config } });

  const read = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, ConfigProvider.ConfigProvider, env);

  return { ws, config, read };
});

const serverNames = (plugin: McpPlugin | undefined) => plugin?.servers.map((server) => server.name);

const SEARCH = {
  command: "${CLAUDE_PLUGIN_ROOT}/bin/search",
  args: ["--cache", "${CLAUDE_PLUGIN_DATA}"],
};

const claudeSetup = Effect.gen(function* () {
  const setup = yield* pluginsSetup;
  const { ws, config } = setup;

  yield* setUpClaudePlugins(
    config,
    {
      "docs@market": {
        files: {
          ".claude-plugin/plugin.json": { name: "Docs", description: "Search the docs" },
          ".mcp.json": {
            mcpServers: {
              search: SEARCH,
              ask: { command: "ask", env: { KEY: "${user_config.key}" } },
            },
          },
        },
      },
      "mine@market": {
        projectPath: ws.root,
        files: {
          ".claude-plugin/plugin.json": {
            mcpServers: ["../../escape.json", { inline: { url: "https://mine.example/mcp" } }],
          },
        },
      },
      "theirs@market": {
        projectPath: "/elsewhere",
        files: { ".mcp.json": { mcpServers: { theirs: { command: "theirs" } } } },
      },
      "quiet@market": {
        files: { ".mcp.json": { mcpServers: { quiet: { command: "quiet" } } } },
      },
      "skills@market": { files: { "skills/clip/SKILL.md": "# Clip\n" } },
    },
    {
      "docs@market": true,
      "mine@market": true,
      "theirs@market": true,
      "quiet@market": true,
      "skills@market": true,
    },
  );

  yield* writeFiles(ws.root, {
    ".claude/settings.json": { enabledPlugins: { "quiet@market": false } },
  });

  yield* writeFiles(join(config, "plugins", "cache", "market"), {
    "escape.json": { mcpServers: { escaped: { command: "escaped" } } },
  });

  return setup;
});

describe("Claude Code's plugins", () => {
  it.live("are the ones on here that bring servers Claude Code can start on its own", () =>
    Effect.gen(function* () {
      const { read } = yield* claudeSetup;
      const plugins = yield* read(claudePlugins());

      expect(plugins.map((plugin) => [plugin.id, plugin.title, plugin.description])).toEqual([
        ["docs@market", "Docs", "Search the docs"],
        ["mine@market", "mine", undefined],
      ]);
      expect(serverNames(plugins[0])).toEqual(["search"]);
      expect(serverNames(plugins[1])).toEqual(["inline"]);
    }),
  );

  it.live("start in a run as Claude Code starts them, named for the plugin", () =>
    Effect.gen(function* () {
      const { config, read } = yield* claudeSetup;
      const [docs, mine] = yield* read(claudePlugins());
      const root = pluginFolder(config, "docs@market");
      const data = join(config, "plugins", "data", "docs-market");

      expect(docs === undefined ? [] : claudePluginRunServers(docs)).toEqual([
        {
          agent: "claude",
          name: "plugin:docs:search",
          source: "user",
          entry: {
            command: `${root}/bin/search`,
            args: ["--cache", data],
            env: { CLAUDE_PLUGIN_ROOT: root, CLAUDE_PLUGIN_DATA: data },
          },
        },
      ]);

      expect(mine === undefined ? [] : claudePluginRunServers(mine)).toEqual([
        {
          agent: "claude",
          name: "plugin:mine:inline",
          source: "user",
          entry: { url: "https://mine.example/mcp" },
        },
      ]);
    }),
  );

  it.live("are named again for a change in what they start, but not in how they're described", () =>
    Effect.gen(function* () {
      const { config, read } = yield* claudeSetup;
      const [before] = yield* read(claudePlugins());
      const files = pluginFolder(config, "docs@market");

      yield* writeFiles(files, {
        ".claude-plugin/plugin.json": { name: "docs", description: "Find things in the docs" },
      });

      const [described] = yield* read(claudePlugins());

      yield* writeFiles(files, {
        ".mcp.json": { mcpServers: { search: { ...SEARCH, args: ["--all"] } } },
      });

      const [changed] = yield* read(claudePlugins());

      const [first, second, third] = yield* read(
        Effect.forEach([before, described, changed], (plugin) =>
          plugin === undefined ? Effect.succeed("") : pluginFingerprint(plugin),
        ),
      );

      expect(second).toBe(first ?? "");
      expect(third).not.toBe(first ?? "");
    }),
  );
});

const codexSetup = Effect.gen(function* () {
  const setup = yield* pluginsSetup;
  const { config } = setup;

  yield* writeFiles(config, {
    "config.toml": `[mcp_servers.web]
url = "https://x"

[plugins."notes@local"]
enabled = true

[plugins."old@local"]

[plugins."gone@local"]
enabled = false

[plugins."apps@openai-curated"]
enabled = true
`,
  });

  yield* writeFiles(pluginFolder(config, "notes@local", "1.2.0"), {
    ".mcp.json": { mcpServers: { stale: { command: "stale" } } },
  });

  yield* writeFiles(pluginFolder(config, "notes@local", "1.10.0"), {
    ".codex-plugin/plugin.json": {
      name: "notes",
      interface: {
        displayName: "Notes",
        shortDescription: "Your notes",
        logo: "./assets/logo.png",
      },
      mcpServers: "./servers.json",
    },
    "servers.json": {
      mcpServers: {
        notes: { command: "notes-mcp" },
        web: { url: "https://y" },
        quiet: { command: "quiet", enabled: false },
      },
    },
    "assets/logo.png": "PNG",
  });

  yield* writeFiles(pluginFolder(config, "old@local", "2.0.0"), {
    ".mcp.json": { mcpServers: { newer: { command: "newer" } } },
  });

  yield* writeFiles(pluginFolder(config, "old@local", "latest"), {
    "mcp.json": { later: { command: "later" } },
  });

  for (const id of ["gone@local", "apps@openai-curated"]) {
    yield* writeFiles(pluginFolder(config, id), {
      ".mcp.json": { mcpServers: { [id]: { command: "x" } } },
    });
  }

  return setup;
});

describe("Codex's plugins", () => {
  it.live("are the ones on in its config that bring servers, in the version Codex loads", () =>
    Effect.gen(function* () {
      const { read } = yield* codexSetup;
      const plugins = yield* read(codexPlugins());

      expect(plugins.map((plugin) => [plugin.id, plugin.title, plugin.description])).toEqual([
        ["notes@local", "Notes", "Your notes"],
        ["old@local", "old", undefined],
      ]);
      expect(serverNames(plugins[0])).toEqual(["notes"]);
      expect(serverNames(plugins[1])).toEqual(["later"]);
    }),
  );

  it.live("show their picture, when it's one the board can", () =>
    Effect.gen(function* () {
      const { config, read } = yield* codexSetup;
      const [notes] = yield* read(codexPlugins());
      const logo = notes?.logoFile ?? "";

      expect(yield* read(pluginLogo(logo))).toBe(`data:image/png;base64,${btoa("PNG")}`);

      yield* writeFiles(config, { "big.png": "x".repeat(256 * 1024 + 1), "logo.gif": "GIF" });

      expect(yield* read(pluginLogo(join(config, "big.png")))).toBeUndefined();
      expect(yield* read(pluginLogo(join(config, "logo.gif")))).toBeUndefined();
      expect(yield* read(pluginLogo(join(config, "missing.png")))).toBeUndefined();
    }),
  );
});
