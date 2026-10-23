import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, type Layer } from "effect";

import {
  type McpPlugin,
  claudePluginRunServers,
  claudePlugins,
  codexPlugins,
  pluginFingerprint,
  pluginLogo,
} from "../src/core/mcpPlugins.ts";
import { pluginFolder, setUpClaudePlugins, writeFiles } from "./pluginFixtures.ts";
import { makeWorkspace, type TestServices, type TestWorkspace } from "./support.ts";

let t: TestWorkspace;

/** Claude Code's and Codex's config folder at once, as `CLAUDE_CONFIG_DIR` and `CODEX_HOME`. */
let config: string;

let env: Layer.Layer<never>;

beforeEach(async () => {
  t = await makeWorkspace("Plugins");
  config = await mkdtemp(join(tmpdir(), "cutfac-agent-config-"));

  env = ConfigProvider.layer(
    ConfigProvider.fromEnv({ env: { CLAUDE_CONFIG_DIR: config, CODEX_HOME: config } }),
  );
});

afterEach(async () => {
  await rm(config, { recursive: true, force: true });
  await t.remove();
});

const read = <A, E>(effect: Effect.Effect<A, E, TestServices>) => t.runWith(env, effect);

const serverNames = (plugin: McpPlugin | undefined) => plugin?.servers.map((server) => server.name);

const SEARCH = {
  command: "${CLAUDE_PLUGIN_ROOT}/bin/search",
  args: ["--cache", "${CLAUDE_PLUGIN_DATA}"],
};

describe("Claude Code's plugins", () => {
  beforeEach(async () => {
    await setUpClaudePlugins(
      config,
      {
        "docs@market": {
          files: {
            ".claude-plugin/plugin.json": { name: "docs", description: "Search the docs" },
            ".mcp.json": {
              mcpServers: {
                search: SEARCH,
                ask: { command: "ask", env: { KEY: "${user_config.key}" } },
              },
            },
          },
        },
        "mine@market": {
          projectPath: t.root,
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

    await writeFiles(t.root, {
      ".claude/settings.json": { enabledPlugins: { "quiet@market": false } },
    });

    await writeFiles(join(config, "plugins", "cache", "market"), {
      "escape.json": { mcpServers: { escaped: { command: "escaped" } } },
    });
  });

  test("are the ones on here that bring servers Claude Code can start on its own", async () => {
    const plugins = await read(claudePlugins());

    expect(plugins.map((plugin) => [plugin.id, plugin.title, plugin.description])).toEqual([
      ["docs@market", "docs", "Search the docs"],
      ["mine@market", "mine", undefined],
    ]);
    // A server that asks the user for a value when the plugin is turned on can't start in a run.
    expect(serverNames(plugins[0])).toEqual(["search"]);
    // Nor is a file outside the plugin read.
    expect(serverNames(plugins[1])).toEqual(["inline"]);
  });

  test("start in a run as Claude Code starts them, named for the plugin", async () => {
    const [docs, mine] = await read(claudePlugins());
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
  });

  test("are named again for a change in what they start, but not in how they're described", async () => {
    const [before] = await read(claudePlugins());
    const files = pluginFolder(config, "docs@market");

    await writeFiles(files, {
      ".claude-plugin/plugin.json": { name: "docs", description: "Find things in the docs" },
    });

    const [described] = await read(claudePlugins());

    await writeFiles(files, {
      ".mcp.json": { mcpServers: { search: { ...SEARCH, args: ["--all"] } } },
    });

    const [changed] = await read(claudePlugins());

    const [first, second, third] = await read(
      Effect.forEach([before, described, changed], (plugin) =>
        plugin === undefined ? Effect.succeed("") : pluginFingerprint(plugin),
      ),
    );

    expect(second).toBe(first ?? "");
    expect(third).not.toBe(first ?? "");
  });
});

describe("Codex's plugins", () => {
  beforeEach(async () => {
    await writeFiles(config, {
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

    await writeFiles(pluginFolder(config, "notes@local", "1.2.0"), {
      ".mcp.json": { mcpServers: { stale: { command: "stale" } } },
    });

    await writeFiles(pluginFolder(config, "notes@local", "1.10.0"), {
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

    await writeFiles(pluginFolder(config, "old@local", "2.0.0"), {
      ".mcp.json": { mcpServers: { newer: { command: "newer" } } },
    });

    await writeFiles(pluginFolder(config, "old@local", "latest"), {
      "mcp.json": { later: { command: "later" } },
    });

    for (const id of ["gone@local", "apps@openai-curated"]) {
      await writeFiles(pluginFolder(config, id), {
        ".mcp.json": { mcpServers: { [id]: { command: "x" } } },
      });
    }
  });

  test("are the ones on in its config that bring servers, in the version Codex loads", async () => {
    const plugins = await read(codexPlugins());

    expect(plugins.map((plugin) => [plugin.id, plugin.title, plugin.description])).toEqual([
      ["notes@local", "Notes", "Your notes"],
      ["old@local", "old", undefined],
    ]);
    // A server of the config's own is offered on its own, and one the plugin turns off isn't.
    expect(serverNames(plugins[0])).toEqual(["notes"]);
    expect(serverNames(plugins[1])).toEqual(["later"]);
  });

  test("show their picture, when it's one the board can", async () => {
    const [notes] = await read(codexPlugins());
    const logo = notes?.logoFile ?? "";

    expect(await read(pluginLogo(logo))).toBe(`data:image/png;base64,${btoa("PNG")}`);

    await writeFiles(config, { "big.png": "x".repeat(256 * 1024 + 1), "logo.gif": "GIF" });

    expect(await read(pluginLogo(join(config, "big.png")))).toBeUndefined();
    expect(await read(pluginLogo(join(config, "logo.gif")))).toBeUndefined();
    expect(await read(pluginLogo(join(config, "missing.png")))).toBeUndefined();
  });
});
