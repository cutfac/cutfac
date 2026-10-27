import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, type Schema } from "effect";

import {
  type McpServer,
  claudeRunServers,
  claudeServers,
  codexCandidates,
  configServers,
  launchView,
  serverFingerprint,
  shownUrl,
} from "../src/core/mcpServers.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const claude = (name: string, entry: Schema.JsonObject): McpServer => ({
  agent: "claude",
  name,
  source: "user",
  entry,
});

const codex = (name: string, entry: Schema.JsonObject): McpServer => ({
  agent: "codex",
  name,
  source: "user",
  entry,
});

describe("the name of how an MCP server starts", () => {
  let t: TestWorkspace;
  const print = (server: McpServer) => t.run(serverFingerprint(server));

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("changes with what it runs and the secrets it gets, not their values", async () => {
    const entry = { command: "npx", args: ["-y", "srv"], env: { TOKEN: "a", REGION: "eu" } };
    const first = await print(claude("srv", entry));

    // A rotated key, or the same settings in another order, is the same agreement.
    expect(await print(claude("srv", { ...entry, env: { REGION: "us", TOKEN: "b" } }))).toBe(first);
    expect(
      await print(claude("srv", { args: ["-y", "srv"], env: entry.env, command: "npx" })),
    ).toBe(first);

    expect(await print(claude("srv", { ...entry, command: "bunx" }))).not.toBe(first);
    expect(await print(claude("srv", { ...entry, args: ["-y", "srv", "--all"] }))).not.toBe(first);
    expect(await print(claude("srv", { ...entry, env: { ...entry.env, EXTRA: "1" } }))).not.toBe(
      first,
    );
  });

  test("reads the same for a Codex server from its config as from Codex's own list", async () => {
    const [fromConfig] = configServers(`
[mcp_servers.docs]
command = "npx"
args = ["-y", "docs-mcp"]
env = { KEY = "secret" }
startup_timeout_sec = 20
`);

    const [fromList] = codexCandidates([
      {
        name: "docs",
        enabled: true,
        entry: {
          type: "stdio",
          command: "npx",
          args: ["-y", "docs-mcp"],
          env: { KEY: "other" },
          env_vars: [],
          cwd: null,
        },
      },
    ]);

    expect(fromConfig).toBeDefined();
    expect(fromList).toBeDefined();
    expect(await print(fromConfig ?? codex("x", {}))).toBe(await print(fromList ?? codex("y", {})));
  });
});

describe("a Codex config's servers", () => {
  test("are the ones that are on and not Cutfac's own", () => {
    const servers = configServers(`
model = "gpt-5"

[mcp_servers.docs]
command = "docs"

[mcp_servers.off]
command = "off"
enabled = false

[mcp_servers.cutfac-mine]
command = "/opt/cutfac"
`);

    expect(servers).toEqual([codex("docs", { command: "docs" })]);
  });

  test("are none when the file isn't TOML or has none", () => {
    expect(configServers("[mcp_servers")).toEqual([]);
    expect(configServers('[[mcp_servers]]\ncommand = "x"\n')).toEqual([]);
    expect(configServers('model = "gpt-5"')).toEqual([]);
  });
});

describe("what the user sees of a server", () => {
  test("is its address without what could carry a key", () => {
    expect(shownUrl("https://me:pw@api.example.com/mcp?key=abc#top")).toBe(
      "https://api.example.com/mcp?…",
    );
    expect(shownUrl("https://api.example.com/mcp")).toBe("https://api.example.com/mcp");
  });

  test("is the command it runs, and the names of what it gets", () => {
    expect(
      launchView(
        claude("srv", {
          command: "/opt/my tools/srv",
          args: ["--root", "it's here"],
          env: { TOKEN: "x", A: "y" },
          headersHelper: "./headers.sh",
        }),
      ),
    ).toEqual({
      kind: "command",
      launch: `'/opt/my tools/srv' --root 'it'\\''s here'`,
      helper: "./headers.sh",
      env: ["A", "TOKEN"],
      headers: [],
    });

    expect(
      launchView(
        codex("api", {
          url: "https://api.example.com/mcp?k=1",
          bearer_token_env_var: "API_TOKEN",
          http_headers: { "X-Team": "a" },
          env_http_headers: { "X-Key": "KEY_VAR" },
        }),
      ),
    ).toEqual({
      kind: "url",
      launch: "https://api.example.com/mcp?…",
      helper: undefined,
      env: ["API_TOKEN"],
      headers: ["X-Team", "X-Key"],
    });
  });

  test("shows paths under the home folder from ~, and a ~ the agent passes on as it is", () => {
    const server = claude("srv", {
      command: "/home/me/bin/srv",
      args: [
        "--root",
        "/home/me",
        "/home/me/",
        "/home/me/my notes",
        "/home/meg/x",
        "/opt/x",
        "~/x",
      ],
    });

    expect(launchView(server, "/home/me/").launch).toBe(
      `~/bin/srv --root ~ ~/ ~/'my notes' /home/meg/x /opt/x '~/x'`,
    );
    // A home folder of `/` would turn every path into `~`.
    expect(launchView(server, "/").launch).toBe(launchView(server).launch);
  });
});

describe("the servers a Claude run loads", () => {
  test("read what could be a secret from variables, off the command line", () => {
    const run = claudeRunServers([
      claude("files", {
        command: "npx",
        args: ["-y", "files-mcp", "--api-key=sk-1"],
        env: { TOKEN: "t-1", HOME_DIR: "${HOME}" },
      }),
      claude("my.api", {
        type: "http",
        url: "https://api.example.com/mcp?key=k-1",
        headers: { Authorization: "Bearer b-1" },
      }),
    ]);

    expect(run.servers).toEqual({
      files: {
        command: "npx",
        args: ["${CUTFAC_MCP_SECRET_0}", "${CUTFAC_MCP_SECRET_1}", "${CUTFAC_MCP_SECRET_2}"],
        env: { TOKEN: "${CUTFAC_MCP_SECRET_3}", HOME_DIR: "${HOME}" },
      },
      "my.api": {
        type: "http",
        url: "${CUTFAC_MCP_SECRET_4}",
        headers: { Authorization: "${CUTFAC_MCP_SECRET_5}" },
      },
    });

    expect(run.env).toEqual({
      CUTFAC_MCP_SECRET_0: "-y",
      CUTFAC_MCP_SECRET_1: "files-mcp",
      CUTFAC_MCP_SECRET_2: "--api-key=sk-1",
      CUTFAC_MCP_SECRET_3: "t-1",
      CUTFAC_MCP_SECRET_4: "https://api.example.com/mcp?key=k-1",
      CUTFAC_MCP_SECRET_5: "Bearer b-1",
    });
  });
});

describe("the servers Claude Code would load in a workspace", () => {
  let t: TestWorkspace;
  let config: string;

  const found = () =>
    t.runWith(
      ConfigProvider.layer(ConfigProvider.fromEnv({ env: { CLAUDE_CONFIG_DIR: config } })),
      claudeServers(),
    );

  beforeEach(async () => {
    t = await makeWorkspace("Claude servers");
    config = await mkdtemp(join(tmpdir(), "cutfac-claude-config-"));
  });

  afterEach(async () => {
    await rm(config, { recursive: true, force: true });
    await t.remove();
  });

  test("are the user's, the workspace's, then this folder's own, without Cutfac's", async () => {
    await writeFile(
      join(config, ".claude.json"),
      JSON.stringify({
        mcpServers: {
          shared: { command: "user-shared" },
          mine: { command: "user-mine" },
          cutfac: { command: "/opt/cutfac" },
        },
        projects: {
          [t.root]: { mcpServers: { shared: { command: "local-shared" } } },
          "/elsewhere": { mcpServers: { other: { command: "other" } } },
        },
      }),
    );

    await writeFile(
      join(t.root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          mine: { command: "project-mine" },
          "cutfac-test": { command: "/opt/cutfac" },
          broken: "not a server",
        },
      }),
    );

    const { servers, problems } = await found();

    expect(problems).toEqual([]);
    expect(servers).toEqual([
      { agent: "claude", name: "shared", source: "local", entry: { command: "local-shared" } },
      { agent: "claude", name: "mine", source: "project", entry: { command: "project-mine" } },
    ]);
  });

  test("are none, saying why, when a config isn't JSON", async () => {
    await writeFile(join(config, ".claude.json"), "{ nope");
    await writeFile(join(t.root, ".mcp.json"), "{ nope");

    expect(await found()).toEqual({
      servers: [],
      problems: [
        "Claude Code's .claude.json is not JSON Cutfac can read",
        ".mcp.json is not JSON Cutfac can read",
      ],
    });
  });

  test("are none while the user has no Claude Code config", async () => {
    expect(await found()).toEqual({ servers: [], problems: [] });
  });
});
