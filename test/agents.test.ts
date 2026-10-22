import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { agentInvocation } from "../src/core/agentCommand.ts";
import {
  agentStatus,
  codexRunServers,
  codexServerLaunch,
  connectClaude,
  connectCodex,
  mcpLaunch,
  runMcpConfig,
  targetsRoot,
} from "../src/core/agents.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

describe("connectClaude", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
  });

  afterEach(() => t.remove());

  test("merges into an existing .mcp.json", async () => {
    await writeFile(
      join(t.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "x" } }, keep: true }),
    );

    await t.run(connectClaude(mcpLaunch({ command: "bun", args: ["/opt/cutfac/cli.ts"] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(Object.keys(config.mcpServers).toSorted()).toEqual(["cutfac", "other"]);
    expect(config.keep).toBe(true);
    expect(config.mcpServers["cutfac"]).toEqual({
      command: "bun",
      args: ["/opt/cutfac/cli.ts", "mcp", "--workspace", t.root],
    });
  });

  test("creates .mcp.json when the workspace has none", async () => {
    await t.run(connectClaude(mcpLaunch({ command: "/opt/cutfac", args: [] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(config.mcpServers["cutfac"].args).toEqual(["mcp", "--workspace", t.root]);
  });

  test("replaces the entry from before the rename to Cutfac", async () => {
    await writeFile(
      join(t.root, ".mcp.json"),
      JSON.stringify({ mcpServers: { "content-factory": { command: "old" }, other: {} } }),
    );

    await t.run(connectClaude(mcpLaunch({ command: "/opt/cutfac", args: [] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(Object.keys(config.mcpServers).toSorted()).toEqual(["cutfac", "other"]);
  });
});

describe("connectCodex", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("registers under the new name and removes the one from before the rename", async () => {
    // Only the registration from before the rename exists.
    await fakes.bin(
      "codex",
      `echo "$*" >> "${fakes.calls}/log"
case "$1 $2 $3" in
  "mcp get content-factory-test") exit 0 ;;
  "mcp get "*) exit 1 ;;
esac
exit 0
`,
    );

    const connection = await t.runWith(
      fakes.layer,
      connectCodex(mcpLaunch({ command: "/opt/cutfac", args: [] }, t.root)),
    );

    const calls = await readFile(join(fakes.calls, "log"), "utf8");

    expect(connection).toMatchObject({ ok: true, detail: expect.stringContaining("cutfac-test") });
    expect(calls.trim().split("\n")).toEqual([
      "mcp get content-factory-test",
      "mcp remove content-factory-test",
      "mcp get cutfac-test",
      `mcp add cutfac-test -- /opt/cutfac mcp --workspace ${t.root}`,
    ]);
  });
});

describe("targetsRoot", () => {
  test("only args with --workspace followed by that root target it", () => {
    expect(targetsRoot(["mcp", "--workspace", "/a"], "/a")).toBe(true);
    expect(targetsRoot(["mcp", "--workspace", "/a"], "/b")).toBe(false);
    expect(targetsRoot(["mcp", "/a"], "/a")).toBe(false);
  });
});

const launch = (root: string) => mcpLaunch({ command: "/opt/cutfac", args: [] }, root);

describe("a copied workspace", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  const writeMcp = (root: string) =>
    writeFile(
      join(t.root, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          cutfac: { command: "/opt/cutfac", args: launch(root).args },
          "content-factory": { command: "old" },
          other: { command: "x" },
        },
      }),
    );

  /** A fake codex whose registration starts the server for `root`. */
  const codexRegisteredFor = (root: string) =>
    fakes.bin(
      "codex",
      `if [ "$1 $2 $3 $4" = "mcp get cutfac-test --json" ]; then
  echo '{"name":"cutfac-test","transport":{"type":"stdio","command":"/opt/cutfac","args":["mcp","--workspace","${root}"]}}'
  exit 0
fi
exit 1
`,
    );

  test("is not connected while its entries start the server for the old root", async () => {
    await writeMcp("/elsewhere");
    await codexRegisteredFor("/elsewhere");

    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.connected).toBe(false);
    expect(codex?.connected).toBe(false);
  });

  test("is connected when the entries start the server for its own root", async () => {
    await writeMcp(t.root);
    await codexRegisteredFor(t.root);

    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.connected).toBe(true);
    expect(codex?.connected).toBe(true);
  });

  test("runs claude with this root's server and keeps the other servers", async () => {
    await writeMcp("/elsewhere");

    const config = JSON.parse(await t.run(runMcpConfig(launch(t.root))));

    expect(Object.keys(config.mcpServers).toSorted()).toEqual(["cutfac", "other"]);
    expect(config.mcpServers["cutfac"]).toEqual({
      command: "/opt/cutfac",
      args: ["mcp", "--workspace", t.root],
    });
  });

  test("runs codex with its server overridden for this root", () => {
    const codexServer = codexServerLaunch("cutfac-test", launch("/here"));

    const { args } = agentInvocation("codex", {
      bin: "/bin/codex",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
      allowedTools: [],
      codexServer,
    });

    expect(codexServer).toEqual([
      'mcp_servers.cutfac-test.command="/opt/cutfac"',
      'mcp_servers.cutfac-test.args=["mcp","--workspace","/here"]',
      'mcp_servers.cutfac-test.disabled_tools=["send_feedback_to_cutfac"]',
    ]);

    for (const entry of codexServer) expect(args[args.indexOf(entry) - 1]).toBe("-c");
  });

  test("a board run never gets the tool that sends feedback to the Cutfac team", () => {
    const { args } = agentInvocation("claude", {
      bin: "/bin/claude",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
      allowedTools: ["mcp__cutfac"],
    });

    expect(args[args.indexOf("--disallowedTools") + 1]).toBe(
      "mcp__cutfac__send_feedback_to_cutfac",
    );
  });

  test("a codex board run switches off the other workspaces' servers and keeps the rest", () => {
    const listed = ["cutfac-test", "cutfac-other", "content-factory-old", "github"];

    expect(codexRunServers("cutfac-test", launch("/here"), listed)).toEqual([
      "mcp_servers.cutfac-other.enabled=false",
      "mcp_servers.content-factory-old.enabled=false",
      ...codexServerLaunch("cutfac-test", launch("/here")),
    ]);
  });

  test("without the CLI, a codex board run narrows this workspace's server only when registered", () => {
    const off = 'mcp_servers.cutfac-test.disabled_tools=["send_feedback_to_cutfac"]';

    expect(codexRunServers("cutfac-test", undefined, ["cutfac-test", "cutfac-other"])).toEqual([
      "mcp_servers.cutfac-other.enabled=false",
      off,
    ]);
    expect(codexRunServers("cutfac-test", undefined, ["github"])).toEqual([]);
  });
});
