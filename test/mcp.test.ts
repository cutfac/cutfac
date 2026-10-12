import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../src/mcp/server.ts";
import { Workspace } from "../src/core/workspace.ts";

let root: string;
let client: Client;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "factory-mcp-"));
  await writeFile(join(root, "factory.yaml"), "name: mcp\n");
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createMcpServer(await Workspace.open(root)).connect(serverSide);
  client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
});
afterAll(() => rm(root, { recursive: true, force: true }));

const text = (res: unknown) =>
  JSON.parse((res as { content: { text: string }[] }).content[0]!.text);

test("agents can create an item and record a schedule", async () => {
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name)).toContain("set_schedule");
  const created = text(
    await client.callTool({
      name: "create_item",
      arguments: { title: "First post", format: "demo" },
    }),
  );
  expect(created.id).toBe("demo/first-post");
  const scheduled = text(
    await client.callTool({
      name: "set_schedule",
      arguments: {
        id: created.id,
        platform: "tiktok",
        at: "2026-10-13T19:00:00+09:00",
        status: "scheduled",
      },
    }),
  );
  expect(scheduled.status).toBe("scheduled");
  const overview = text(await client.callTool({ name: "workspace_overview", arguments: {} }));
  expect(overview.items).toEqual({ scheduled: 1 });
});
