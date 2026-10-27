import { join } from "node:path";

import {
  type Cause,
  Deferred,
  Effect,
  FileSystem,
  HashMap,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { FakeAgentDir } from "./support.ts";

const CLI = join(import.meta.dir, "../src/cli.ts");

/** A JSON-RPC error, or a tool's result saying it failed. */
export class McpFailed extends Schema.TaggedError<McpFailed>()("McpFailed", {
  message: Schema.String,
}) {}

const RpcResponse = Schema.Struct({
  id: Schema.optional(Schema.Finite),
  result: Schema.optional(Schema.Json),
  error: Schema.optional(Schema.Struct({ message: Schema.String })),
});

type RpcResponse = typeof RpcResponse.Type;

const decodeLine = Schema.decodeEffect(Schema.fromJsonString(RpcResponse));

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const ToolResult = Schema.Struct({
  isError: Schema.optional(Schema.Boolean),
  structuredContent: Schema.optional(Schema.Json),
  content: Schema.Array(
    Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) }),
  ),
});

/** What `workspace_overview` says: the items by status, and what the agent should look at. */
export const Overview = Schema.Struct({
  items: Schema.Record(Schema.String, Schema.Finite),
  notices: Schema.Array(Schema.String),
});

const encoder = new TextEncoder();

/** Agents that are up to date, so the notices a test reads do not depend on what is installed here. */
export const upToDateAgents = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;

  yield* fakes.bin("claude", 'echo "99.0.0 (Claude Code)"\n');
  yield* fakes.bin("codex", 'echo "codex-cli 99.0.0"\n');

  return fakes;
});

/** The Cutfac team's feedback address, which keeps what it is sent instead of reaching cutfac.com. */
const teamSite = Effect.gen(function* () {
  const received: URLSearchParams[] = [];

  const site = yield* Effect.acquireRelease(
    Effect.sync(() =>
      Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch: async (request) => {
          received.push(new URLSearchParams(await request.text()));

          return Response.json({ ok: true });
        },
      }),
    ),
    (running) => Effect.promise(() => running.stop()),
  );

  return { url: new URL("/api/feedback", site.url).href, received };
});

export interface McpOptions {
  /** Whose fake agent CLIs come before any other on PATH; the test's own when left out. */
  readonly agents?: FakeAgentDir["Service"];
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * A `cutfac mcp` for the workspace at `root`, spoken to over newline-delimited JSON-RPC as Claude
 * Code does, and stopped when the test ends. It is a fresh Bun process, so on a busy machine it
 * takes seconds to start.
 */
export const mcpServer = Effect.fnUntraced(function* (root: string, options: McpOptions = {}) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const agents = options.agents ?? (yield* FakeAgentDir);
  const team = yield* teamSite;
  // A home with no agent config, so the MCP servers set up on this machine stay out of notices.
  const home = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-mcp-home-" });
  const lines = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const pending = yield* Ref.make(HashMap.empty<number, Deferred.Deferred<RpcResponse>>());
  const lastId = yield* Ref.make(0);

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [CLI, "mcp", "--workspace", root], {
      env: {
        HOME: home,
        CLAUDE_CONFIG_DIR: home,
        CODEX_HOME: home,
        CUTFAC_FEEDBACK_URL: team.url,
        PATH: `${join(agents.dir, "bin")}:${process.env["PATH"] ?? ""}`,
        ...options.env,
      },
      extendEnv: true,
      stdin: Stream.fromQueue(lines),
    }),
  );

  const answer = (response: RpcResponse) =>
    Effect.gen(function* () {
      const waiting = HashMap.get(yield* Ref.get(pending), response.id ?? -1);

      if (Option.isSome(waiting)) yield* Deferred.succeed(waiting.value, response);
    });

  yield* handle.stdout.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.filter((line) => line.trim() !== ""),
    Stream.mapEffect((line) => decodeLine(line)),
    Stream.runForEach(answer),
    Effect.orDie,
    Effect.forkScoped,
  );

  yield* handle.stderr.pipe(Stream.runDrain, Effect.orDie, Effect.forkScoped);

  const send = (message: {
    readonly id?: number;
    readonly method: string;
    readonly params?: Schema.JsonObject;
  }) => Queue.offer(lines, encoder.encode(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`));

  const request = Effect.fnUntraced(function* <A>(
    method: string,
    params: Schema.JsonObject,
    schema: Schema.Decoder<A>,
  ) {
    const id = yield* Ref.updateAndGet(lastId, (last) => last + 1);
    const answered = yield* Deferred.make<RpcResponse>();

    yield* Ref.update(pending, HashMap.set(id, answered));
    yield* send({ id, method, params });

    const response = yield* Deferred.await(answered);

    if (response.error !== undefined)
      return yield* new McpFailed({ message: response.error.message });

    return yield* Effect.orDie(Schema.decodeEffect(schema)(response.result));
  });

  /** Call a tool and decode its structured result, failing on an error result. */
  const call = Effect.fnUntraced(function* <A>(
    name: string,
    args: Schema.JsonObject,
    schema: Schema.Decoder<A>,
  ) {
    const result = yield* request("tools/call", { name, arguments: args }, ToolResult);
    const text = result.content[0]?.text ?? "null";

    if (result.isError === true) return yield* new McpFailed({ message: text });

    const content = result.structuredContent ?? (yield* Effect.orDie(decodeJson(text)));

    return yield* Effect.orDie(Schema.decodeEffect(schema)(content));
  });

  yield* request(
    "initialize",
    {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    },
    Schema.Struct({ protocolVersion: Schema.String }),
  );

  yield* send({ method: "notifications/initialized" });

  return { request, call, teamFeedback: team.received };
});

export type McpServer = Effect.Success<ReturnType<typeof mcpServer>>;
