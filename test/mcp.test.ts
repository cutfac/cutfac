import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Schema } from "effect";

import { makeWorkspace, type TestWorkspace } from "./support.ts";

const CLI = join(import.meta.dir, "../src/cli.ts");

const RpcResponse = Schema.Struct({
  id: Schema.optional(Schema.Finite),
  result: Schema.optional(Schema.Json),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});

type RpcResponse = typeof RpcResponse.Type;

const decodeLine = Schema.decodeUnknownSync(Schema.fromJsonString(RpcResponse));

interface RpcMessage {
  readonly id?: number;
  readonly method: string;
  readonly params?: Schema.JsonObject;
}

const ToolList = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Json),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
});

const Created = Schema.Struct({ id: Schema.String });

const Scheduled = Schema.Struct({ status: Schema.String });

const Overview = Schema.Struct({
  items: Schema.Record(Schema.String, Schema.Finite),
  notices: Schema.Array(Schema.String),
});

const Skill = Schema.Struct({
  markdown: Schema.String,
  copies: Schema.Array(Schema.Struct({ path: Schema.String, state: Schema.String })),
});

const FormatDetail = Schema.Struct({
  id: Schema.String,
  readme: Schema.optional(Schema.String),
});

const FormatCheck = Schema.Struct({
  ready: Schema.Boolean,
  problems: Schema.Array(Schema.Struct({ kind: Schema.String, subject: Schema.String })),
});

const ItemInputs = Schema.Struct({
  doc: Schema.Struct({ inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
});

/** A newline-delimited JSON-RPC client for `factory mcp`, the way Claude Code talks to it. */
function startServer(root: string) {
  const child = Bun.spawn(["bun", CLI, "mcp", "--workspace", root], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  const pending = new Map<number, (response: RpcResponse) => void>();
  let nextId = 1;

  void (async () => {
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk, { stream: true });
      let newline = buffer.indexOf("\n");

      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");

        if (line === "") continue;
        const message = decodeLine(line);

        if (message.id !== undefined) pending.get(message.id)?.(message);
      }
    }
  })();

  const send = (message: RpcMessage) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
    child.stdin.flush();
  };

  const request = async <A>(
    method: string,
    params: Schema.JsonObject,
    schema: Schema.Decoder<A>,
  ): Promise<A> => {
    const id = nextId++;

    const answered = new Promise<RpcResponse>((resolve) => {
      pending.set(id, resolve);
    });

    send({ id, method, params });
    const response = await answered;

    if (response.error !== undefined) throw new Error(response.error.message);

    return Schema.decodeSync(schema)(response.result);
  };

  /** Call a tool and decode its structured result, failing on an error result. */
  const call = async <A>(
    name: string,
    args: Schema.JsonObject,
    schema: Schema.Decoder<A>,
  ): Promise<A> => {
    const result = await request("tools/call", { name, arguments: args }, ToolResult);
    const text = result.content[0]?.text ?? "null";

    if (result.isError === true) throw new Error(text);

    return Schema.decodeUnknownSync(schema)(result.structuredContent ?? JSON.parse(text));
  };

  return { child, send, request, call };
}

let t: TestWorkspace;

let server: ReturnType<typeof startServer>;

beforeAll(async () => {
  t = await makeWorkspace("mcp");
  server = startServer(t.root);

  await server.request(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
    Schema.Struct({ protocolVersion: Schema.String }),
  );

  server.send({ method: "notifications/initialized" });
  // The server is a fresh Bun process; on a busy machine it takes seconds to start.
}, 30_000);

afterAll(async () => {
  server.child.kill();
  await server.child.exited;
  await t.remove();
});

test("lists the workspace tools", async () => {
  const { tools } = await server.request("tools/list", {}, ToolList);
  const names = tools.map((tool) => tool.name);

  expect(names).toContain("create_item");
  expect(names).toContain("set_schedule");
  expect(names).toContain("workspace_overview");
  expect(names).toContain("check_format");
  expect(names).toContain("get_skill");
  expect(names).toContain("review_media");
}, 20_000);

test("keeps the workspace skill current and tells the agent about an edited copy", async () => {
  const bundled = await readFile(
    join(import.meta.dir, "../skills/content-factory/SKILL.md"),
    "utf8",
  );

  const copy = join(t.root, ".claude/skills/content-factory/SKILL.md");

  // The server installed it on start.
  expect(await readFile(copy, "utf8")).toBe(bundled);
  expect((await server.call("workspace_overview", {}, Overview)).notices).toEqual([]);

  await writeFile(copy, `${bundled}\n- My own rule.\n`);

  const { notices } = await server.call("workspace_overview", {}, Overview);

  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(".claude/skills/content-factory/SKILL.md");

  const skill = await server.call("get_skill", {}, Skill);

  expect(skill.markdown).toBe(bundled);
  expect(skill.copies.map((c) => c.state)).toEqual(["current", "edited"]);
  expect(skill.copies.every((c) => c.path.startsWith("/"))).toBe(true);

  await writeFile(copy, bundled);
}, 20_000);

test("agents can create an item and record a schedule", async () => {
  const created = await server.call(
    "create_item",
    { title: "First post", format: "demo" },
    Created,
  );

  expect(created.id).toBe("demo/first-post");

  const scheduled = await server.call(
    "set_schedule",
    {
      id: created.id,
      platform: "tiktok",
      at: "2026-10-13T19:00:00+09:00",
      status: "scheduled",
    },
    Scheduled,
  );

  expect(scheduled.status).toBe("scheduled");

  const overview = await server.call("workspace_overview", {}, Overview);

  expect(overview.items).toEqual({ scheduled: 1 });
}, 20_000);

test("a tool error comes back as an error result, not a crash", async () => {
  await expect(server.call("get_item", { id: "missing/item" }, Created)).rejects.toThrow(
    "missing/item",
  );

  expect(await server.call("workspace_overview", {}, Overview)).toBeDefined();
}, 20_000);

test("agents can check a template and fill its inputs", async () => {
  await server.call(
    "save_format",
    {
      id: "art",
      title: "Art motion",
      skills: [{ name: "art-motion" }],
      inputs: [
        {
          id: "style",
          title: "Style",
          choices: [
            { id: "swiss", title: "Swiss" },
            { id: "neon", title: "Neon" },
          ],
          default: "swiss",
        },
      ],
    },
    Created,
  );

  // A template the agent has not written a README for yet still reads.
  const format = await server.call("get_format", { id: "art" }, FormatDetail);

  expect(format.id).toBe("art");
  expect(format.readme).toBeUndefined();

  const check = await server.call("check_format", { id: "art" }, FormatCheck);

  expect(check.ready).toBe(false);
  expect(check.problems).toEqual([{ kind: "skill", subject: "art-motion" }]);

  const created = await server.call(
    "create_item",
    { title: "Openings", format: "art", inputs: { style: "neon" } },
    Created,
  );

  const item = await server.call("get_item", { id: created.id }, ItemInputs);

  expect(item.doc.inputs).toEqual({ style: "neon" });
}, 20_000);
