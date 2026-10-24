import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Schema } from "effect";

import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

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

const Updated = Schema.Struct({ status: Schema.String });

const Overview = Schema.Struct({
  items: Schema.Record(Schema.String, Schema.Finite),
  notices: Schema.Array(Schema.String),
});

/** What a result says about the Cutfac app's free version, if anything. */
const FreeVersion = Schema.Struct({ freeVersion: Schema.optional(Schema.String) });

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

/** A home with no agent config, so the MCP servers set up on this machine stay out of notices. */
let home: string;

/** A newline-delimited JSON-RPC client for `cutfac mcp`, the way Claude Code talks to it. */
function startServer(root: string, feedbackUrl: string, env: Record<string, string> = {}) {
  const child = Bun.spawn(["bun", CLI, "mcp", "--workspace", root], {
    env: {
      ...process.env,
      HOME: home,
      CLAUDE_CONFIG_DIR: home,
      CODEX_HOME: home,
      CUTFAC_FEEDBACK_URL: feedbackUrl,
      ...env,
    },
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

  /** Open the session as a client does before calling tools. */
  const initialize = async () => {
    await request(
      "initialize",
      {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0" },
      },
      Schema.Struct({ protocolVersion: Schema.String }),
    );

    send({ method: "notifications/initialized" });
  };

  return { child, send, request, call, initialize };
}

let t: TestWorkspace;

let fakes: FakeAgents;

let server: ReturnType<typeof startServer>;

/** The environment that puts the fake agent CLIs in `agents` ahead of any real ones on PATH. */
const withAgents = (agents: FakeAgents) => ({
  PATH: `${join(agents.dir, "bin")}:${process.env["PATH"] ?? ""}`,
});

/** What the server sent to the Cutfac team, caught here instead of reaching cutfac.com. */
const teamFeedback: URLSearchParams[] = [];

const site = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch: async (request) => {
    teamFeedback.push(new URLSearchParams(await request.text()));

    return Response.json({ ok: true });
  },
});

beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "cutfac-mcp-home-"));
  t = await makeWorkspace("mcp");
  fakes = await makeFakeAgents();

  // Agents that are up to date, so the notices below do not depend on what is installed here.
  await fakes.bin("claude", 'echo "99.0.0 (Claude Code)"\n');
  await fakes.bin("codex", 'echo "codex-cli 99.0.0"\n');
  server = startServer(t.root, new URL("/api/feedback", site.url).href, withAgents(fakes));

  await server.initialize();
  // The server is a fresh Bun process; on a busy machine it takes seconds to start.
}, 30_000);

afterAll(async () => {
  server.child.kill();
  await server.child.exited;
  await site.stop();
  await fakes.remove();
  await t.remove();
  await rm(home, { recursive: true, force: true });
});

test("lists the workspace tools", async () => {
  const { tools } = await server.request("tools/list", {}, ToolList);
  const names = tools.map((tool) => tool.name);

  expect(names).toContain("create_item");
  expect(names).toContain("update_item");
  expect(names).not.toContain("set_schedule");
  expect(names).toContain("workspace_overview");
  expect(names).toContain("check_format");
  expect(names).toContain("get_skill");
  expect(names).toContain("review_media");
  expect(names).toContain("send_feedback_to_cutfac");
  expect(names).toContain("update_brief");
  expect(names).toContain("render");
}, 20_000);

const Brief = Schema.Struct({
  path: Schema.String,
  purpose: Schema.optional(Schema.String),
  platforms: Schema.Array(Schema.String),
  body: Schema.String,
});

test("points agents at a missing brief, and lets them write it from what the user says", async () => {
  const before = await server.call("workspace_overview", {}, Overview);

  expect(before.notices).toHaveLength(1);
  expect(before.notices[0]).toContain(join(t.root, "brief.md"));
  expect(before.notices[0]).toContain("update_brief");

  await server.call(
    "update_brief",
    { purpose: "promote", platforms: ["tiktok"], body: "Videos for my app." },
    Brief,
  );
  const brief = await server.call("update_brief", { platforms: ["tiktok", "reels"] }, Brief);

  expect(brief).toEqual({
    path: join(t.root, "brief.md"),
    purpose: "promote",
    platforms: ["tiktok", "reels"],
    body: "Videos for my app.",
  });
  expect(await readFile(brief.path, "utf8")).toContain("platforms:\n  - tiktok\n  - reels");
  expect((await server.call("workspace_overview", {}, Overview)).notices).toEqual([]);
}, 20_000);

test("offers /feedback as a prompt that drafts before sending", async () => {
  const { prompts } = await server.request(
    "prompts/list",
    {},
    Schema.Struct({
      prompts: Schema.Array(
        Schema.Struct({
          name: Schema.String,
          arguments: Schema.Array(Schema.Struct({ name: Schema.String, required: Schema.Boolean })),
        }),
      ),
    }),
  );

  // Claude Code refuses to run a prompt whose required argument is left out.
  expect(prompts.find((prompt) => prompt.name === "feedback")?.arguments).toEqual([
    { name: "message", required: false },
  ]);

  const prompt = async (args: Record<string, string>) => {
    const { messages } = await server.request(
      "prompts/get",
      { name: "feedback", arguments: args },
      Schema.Struct({
        messages: Schema.Array(Schema.Struct({ content: Schema.Struct({ text: Schema.String }) })),
      }),
    );

    return messages[0]?.content.text ?? "";
  };

  // Claude Code passes on only the first word of `/mcp__cutfac__feedback the trim handles are tiny`.
  const cut = await prompt({ message: "the" });
  const none = await prompt({});

  expect(cut).toContain("What I typed: the\n");
  expect(cut).toContain("take the rest from the command I typed");
  expect(none).toContain("Ask me what I want to tell them.");

  for (const text of [cut, none]) {
    expect(text).toContain("show me the exact text");
    expect(text).toContain("send_feedback_to_cutfac");
  }
}, 20_000);

test("sends feedback with the agent that asked and the version of this build", async () => {
  await server.call(
    "send_feedback_to_cutfac",
    { message: "the trim handles are tiny" },
    Schema.Json,
  );

  const [sent] = teamFeedback;

  expect(sent?.get("message")).toBe("the trim handles are tiny");
  expect(sent?.get("source")).toBe("agent");
  expect(sent?.get("agent")).toBe("test 0");
  expect(sent?.get("version")).toEndWith("-dev");
}, 20_000);

test("tells the agent when an installed agent is too old, and how to update it", async () => {
  const old = await makeFakeAgents();

  await old.bin("claude", 'echo "2.1.1 (Claude Code)"\n');
  await old.bin("codex", 'echo "codex-cli 99.0.0"\n');
  const other = startServer(t.root, new URL("/api/feedback", site.url).href, withAgents(old));

  try {
    await other.initialize();
    const { notices } = await other.call("workspace_overview", {}, Overview);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain("Claude Code 2.1.1");
    expect(notices[0]).toContain("`claude update`");
  } finally {
    other.child.kill();
    await other.child.exited;
    await old.remove();
  }
}, 30_000);

test("keeps the workspace skill current and tells the agent about an edited copy", async () => {
  const bundled = await readFile(join(import.meta.dir, "../skills/cutfac/SKILL.md"), "utf8");

  const copy = join(t.root, ".claude/skills/cutfac/SKILL.md");

  // The server installed it on start.
  expect(await readFile(copy, "utf8")).toBe(bundled);
  expect((await server.call("workspace_overview", {}, Overview)).notices).toEqual([]);

  await writeFile(copy, `${bundled}\n- My own rule.\n`);

  const { notices } = await server.call("workspace_overview", {}, Overview);

  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(".claude/skills/cutfac/SKILL.md");

  const skill = await server.call("get_skill", {}, Skill);

  expect(skill.markdown).toBe(bundled);
  expect(skill.copies.map((c) => c.state)).toEqual(["current", "edited"]);
  expect(skill.copies.every((c) => c.path.startsWith("/"))).toBe(true);

  await writeFile(copy, bundled);
}, 20_000);

const FormatList = Schema.Struct({
  formats: Schema.Array(Schema.Struct({ id: Schema.String })),
  notices: Schema.Array(Schema.String),
});

test("tells the agent about a format.yaml that doesn't read, and still lists the rest", async () => {
  const formats = join(t.root, "formats");
  await mkdir(join(formats, "fine"), { recursive: true });
  await mkdir(join(formats, "half-done"), { recursive: true });
  await writeFile(join(formats, "fine/format.yaml"), "title: Fine\n");
  await writeFile(join(formats, "half-done/format.yaml"), "summary: no title here\n");

  try {
    const { notices } = await server.call("workspace_overview", {}, Overview);
    const listed = await server.call("list_formats", {}, FormatList);

    expect(listed.formats.map((f) => f.id)).toEqual(["fine"]);
    expect(listed.notices).toHaveLength(1);
    expect(listed.notices[0]).toContain("formats/half-done/format.yaml");
    expect(listed.notices[0]).toContain("check_format");
    expect(notices).toContain(listed.notices[0] ?? "");
  } finally {
    for (const id of ["fine", "half-done"]) {
      await rm(join(formats, id), { recursive: true, force: true });
    }
  }
}, 20_000);

test("agents can create an item and hand it over for review", async () => {
  const created = await server.call(
    "create_item",
    { title: "First post", format: "demo" },
    Created,
  );

  expect(created.id).toBe("demo/first-post");

  const updated = await server.call(
    "update_item",
    { id: created.id, status: "review", hook: "One move wins" },
    Updated,
  );

  expect(updated.status).toBe("review");

  const overview = await server.call("workspace_overview", {}, Overview);

  expect(overview.items).toEqual({ review: 1 });
}, 20_000);

test("a tool error comes back as an error result, not a crash", async () => {
  await expect(server.call("get_item", { id: "missing/item" }, Created)).rejects.toThrow(
    "missing/item",
  );

  expect(await server.call("workspace_overview", {}, Overview)).toBeDefined();
}, 20_000);

test("the Cutfac app's free version tells agents what is left, then refuses a new video", async () => {
  const free = await makeWorkspace("free");
  const data = await mkdtemp(join(tmpdir(), "cutfac-app-data-"));

  const app = startServer(free.root, new URL("/api/feedback", site.url).href, {
    CUTFAC_DESKTOP_DATA: data,
  });

  try {
    await app.initialize();

    expect((await server.call("workspace_overview", {}, FreeVersion)).freeVersion).toBeUndefined();
    expect((await app.call("workspace_overview", {}, FreeVersion)).freeVersion).toBe(
      "Cutfac free version: 0 of 3 videos used on this Mac.",
    );

    await app.call("create_item", { title: "One" }, Created);
    await app.call("create_item", { title: "Two" }, Created);

    const last = await app.call(
      "create_item",
      { title: "Three" },
      Schema.Struct({ ...Created.fields, ...FreeVersion.fields }),
    );

    expect(last.freeVersion).toContain("3 of 3 videos used");
    expect(last.freeVersion).toContain("https://cutfac.com/pricing");

    await expect(app.call("create_item", { title: "Four" }, Created)).rejects.toThrow(
      "License Key",
    );

    // The videos already made stay editable.
    expect(await app.call("update_item", { id: last.id, status: "review" }, Updated)).toEqual({
      status: "review",
    });
  } finally {
    app.child.kill();
    await app.child.exited;
    await free.remove();
    await rm(data, { recursive: true, force: true });
  }
}, 60_000);

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
    { title: "Morning routine", format: "art", inputs: { style: "neon" } },
    Created,
  );

  const item = await server.call("get_item", { id: created.id }, ItemInputs);

  expect(item.doc.inputs).toEqual({ style: "neon" });
}, 20_000);
