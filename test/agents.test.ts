import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { connectClaude, mcpLaunch } from "../src/core/agents.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

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

    await t.run(connectClaude(mcpLaunch({ command: "bun", args: ["/opt/cf/cli.ts"] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(Object.keys(config.mcpServers).toSorted()).toEqual(["content-factory", "other"]);
    expect(config.keep).toBe(true);
    expect(config.mcpServers["content-factory"]).toEqual({
      command: "bun",
      args: ["/opt/cf/cli.ts", "mcp", "--workspace", t.root],
    });
  });

  test("creates .mcp.json when the workspace has none", async () => {
    await t.run(connectClaude(mcpLaunch({ command: "/opt/factory", args: [] }, t.root)));
    const config = JSON.parse(await readFile(join(t.root, ".mcp.json"), "utf8"));

    expect(config.mcpServers["content-factory"].args).toEqual(["mcp", "--workspace", t.root]);
  });
});
