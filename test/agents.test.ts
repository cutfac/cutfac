import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, type Schema } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import {
  agentStatus,
  codexRunServers,
  codexServerLaunch,
  connectClaude,
  connectCodex,
  type McpLaunch,
  mcpLaunch,
  runMcpConfig,
  targetsRoot,
} from "../src/core/agents.ts";
import type { CodexListed } from "../src/core/mcpServers.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Test"), fakeAgents));

const writeMcp = (record: Schema.JsonObject) =>
  Effect.flatMap(Workspace, (ws) => ws.writeText(".mcp.json", JSON.stringify(record)));

const mcpJson = Effect.flatMap(Workspace, (ws) => ws.readText(".mcp.json")).pipe(
  Effect.map((text) => JSON.parse(text)),
);

describe("connectClaude", () => {
  it.live("merges into an existing .mcp.json", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* writeMcp({ mcpServers: { other: { command: "x" } }, keep: true });
      yield* connectClaude(mcpLaunch({ command: "bun", args: ["/opt/cutfac/cli.ts"] }, ws.root));

      const config = yield* mcpJson;

      expect(Object.keys(config.mcpServers).toSorted()).toEqual(["cutfac", "other"]);
      expect(config.keep).toBe(true);
      expect(config.mcpServers["cutfac"]).toEqual({
        command: "bun",
        args: ["/opt/cutfac/cli.ts", "mcp", "--workspace", ws.root],
      });
    }),
  );

  it.live("creates .mcp.json when the workspace has none", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* connectClaude(mcpLaunch({ command: "/opt/cutfac", args: [] }, ws.root));

      const config = yield* mcpJson;

      expect(config.mcpServers["cutfac"].args).toEqual(["mcp", "--workspace", ws.root]);
    }),
  );

  it.live("replaces the entry from before the rename to Cutfac", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* writeMcp({ mcpServers: { "content-factory": { command: "old" }, other: {} } });
      yield* connectClaude(mcpLaunch({ command: "/opt/cutfac", args: [] }, ws.root));

      const config = yield* mcpJson;

      expect(Object.keys(config.mcpServers).toSorted()).toEqual(["cutfac", "other"]);
    }),
  );
});

describe("connectCodex", () => {
  it.live("registers under the new name and removes the one from before the rename", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const fakes = yield* FakeAgentDir;
      const fs = yield* FileSystem.FileSystem;

      yield* fakes.bin(
        "codex",
        `echo "$*" >> "${fakes.calls}/log"
case "$1 $2 $3" in
  "mcp get content-factory-test") exit 0 ;;
  "mcp get "*) exit 1 ;;
esac
exit 0
`,
      );

      const connection = yield* connectCodex(
        mcpLaunch({ command: "/opt/cutfac", args: [] }, ws.root),
      );

      const calls = yield* fs.readFileString(join(fakes.calls, "log"));

      expect(connection).toMatchObject({
        ok: true,
        detail: expect.stringContaining("cutfac-test"),
      });
      expect(calls.trim().split("\n")).toEqual([
        "mcp get content-factory-test",
        "mcp remove content-factory-test",
        "mcp get cutfac-test",
        `mcp add cutfac-test -- /opt/cutfac mcp --workspace ${ws.root}`,
      ]);
    }),
  );
});

describe("targetsRoot", () => {
  test("only args with --workspace followed by that root target it", () => {
    expect(targetsRoot(["mcp", "--workspace", "/a"], "/a")).toBe(true);
    expect(targetsRoot(["mcp", "--workspace", "/a"], "/b")).toBe(false);
    expect(targetsRoot(["mcp", "/a"], "/a")).toBe(false);
  });
});

const launch = (root: string) => mcpLaunch({ command: "/opt/cutfac", args: [] }, root);

/** Servers as Codex lists them, all on and started by a command. */
const listing = (...names: string[]): CodexListed[] =>
  names.map((name) => ({ name, enabled: true, transport: "stdio", entry: { type: "stdio" } }));

/** What switches off `name`, a server started by a command. */
const off = (name: string) => [
  `mcp_servers.${name}.enabled=false`,
  `mcp_servers.${name}.command="false"`,
];

const writeEntries = (root: string) =>
  writeMcp({
    mcpServers: {
      cutfac: { command: "/opt/cutfac", args: launch(root).args },
      "content-factory": { command: "old" },
      other: { command: "x" },
    },
  });

const codexRegisteredFor = (root: string) =>
  Effect.flatMap(FakeAgentDir, (fakes) =>
    fakes.bin(
      "codex",
      `if [ "$1 $2 $3 $4" = "mcp get cutfac-test --json" ]; then
  echo '{"name":"cutfac-test","transport":{"type":"stdio","command":"/opt/cutfac","args":["mcp","--workspace","${root}"]}}'
  exit 0
fi
exit 1
`,
    ),
  );

const runServers = (server: McpLaunch | undefined) =>
  Effect.map(runMcpConfig(server), (config) =>
    config === undefined ? undefined : JSON.parse(config).mcpServers,
  );

describe("a copied workspace", () => {
  it.live("is not connected while its entries start the server for the old root", () =>
    Effect.gen(function* () {
      yield* writeEntries("/elsewhere");
      yield* codexRegisteredFor("/elsewhere");

      const [claude, codex] = yield* agentStatus();

      expect(claude?.connected).toBe(false);
      expect(codex?.connected).toBe(false);
    }),
  );

  it.live("is connected when the entries start the server for its own root", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* writeEntries(ws.root);
      yield* codexRegisteredFor(ws.root);

      const [claude, codex] = yield* agentStatus();

      expect(claude?.connected).toBe(true);
      expect(codex?.connected).toBe(true);
    }),
  );

  it.live("runs claude with this root's server alone", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* writeEntries("/elsewhere");

      expect(yield* runServers(launch(ws.root))).toEqual({
        cutfac: { command: "/opt/cutfac", args: ["mcp", "--workspace", ws.root] },
      });
    }),
  );

  it.live(
    "without the CLI, runs claude with the workspace's entry only when it is for this root",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* writeEntries("/elsewhere");
        expect(yield* runServers(undefined)).toBeUndefined();

        yield* writeEntries(ws.root);
        expect(yield* runServers(undefined)).toEqual({
          cutfac: { command: "/opt/cutfac", args: launch(ws.root).args },
        });
      }),
  );

  /** Our server's tools run unasked, but Codex asks the board before one the user has to agree to. */
  const ours = [
    'mcp_servers.cutfac-test.default_tools_approval_mode="approve"',
    'mcp_servers.cutfac-test.tools.send_feedback_to_cutfac.approval_mode="prompt"',
  ];

  test("runs codex with its server overridden for this root", () => {
    const codexConfig = codexServerLaunch("cutfac-test", launch("/here"));

    const { args } = agentInvocation("codex", {
      bin: "/bin/codex",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
      codexConfig,
    });

    expect(codexConfig).toEqual([
      'mcp_servers.cutfac-test.command="/opt/cutfac"',
      'mcp_servers.cutfac-test.args=["mcp","--workspace","/here"]',
      ...ours,
    ]);
    expect(args[0]).toBe("app-server");

    for (const entry of codexConfig) expect(args[args.indexOf(entry) - 1]).toBe("-c");
  });

  test("a board run asks the user before it sends feedback to the Cutfac team", () => {
    const { args } = agentInvocation("claude", {
      bin: "/bin/claude",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
    });

    const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",");

    expect(allowed).toContain("mcp__cutfac__get_item");
    expect(allowed).not.toContain("mcp__cutfac__send_feedback_to_cutfac");
    expect(args).not.toContain("--disallowedTools");
  });

  test("a codex board run switches off every other server and apps", () => {
    const listed = listing("cutfac-test", "cutfac-other", "content-factory-old", "github");

    expect(codexRunServers("cutfac-test", launch("/here"), listed)).toEqual([
      "features.apps=false",
      ...off("cutfac-other"),
      ...off("content-factory-old"),
      ...off("github"),
      ...codexServerLaunch("cutfac-test", launch("/here")),
    ]);
  });

  test("a codex board run keeps plugins on and switches off the servers they bring", () => {
    const listed: CodexListed[] = [
      { name: "obsidian", enabled: true, transport: "stdio", entry: { command: "obsidian-mcp" } },
      { name: "remote", enabled: true, transport: "streamable_http", entry: { url: "https://x" } },
      { name: "review", enabled: false, transport: "stdio", entry: { command: "review-mcp" } },
      { name: "odd", enabled: true, entry: { type: "sse" } },
      { name: "docs", enabled: true, transport: "stdio", entry: { command: "docs-mcp" } },
    ];

    const config = codexRunServers("cutfac-test", undefined, listed, ["docs"]);

    expect(config).toEqual([
      "features.apps=false",
      ...off("obsidian"),
      "mcp_servers.remote.enabled=false",
      'mcp_servers.remote.url="http://127.0.0.1:9"',
      "mcp_servers.odd.enabled=false",
    ]);
    expect(config.some((entry) => entry.startsWith("features.plugins"))).toBe(false);
  });

  test("without the CLI, a codex board run narrows this workspace's server only when registered", () => {
    expect(
      codexRunServers("cutfac-test", undefined, listing("cutfac-test", "cutfac-other")),
    ).toEqual(["features.apps=false", ...off("cutfac-other"), ...ours]);
    expect(codexRunServers("cutfac-test", undefined, listing("github"))).toEqual([
      "features.apps=false",
      ...off("github"),
    ]);
  });
});
