import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { connectClaude, connectCodex, mcpLaunch } from "../src/core/agents.ts";
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
