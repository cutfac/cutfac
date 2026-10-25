import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime, Option, Schema, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import type { RunEvent } from "../src/core/agentParse.ts";
import { RunRegistry } from "../src/core/agentRun.ts";
import { ImportRuns } from "../src/core/importRun.ts";
import { DesktopData } from "../src/plan.ts";
import { routes } from "../src/server/app.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

/** Claude Code asking to run ffmpeg, offering to allow it from now on. */
const REQUEST = JSON.stringify({
  type: "control_request",
  request_id: "r1",
  request: {
    subtype: "can_use_tool",
    tool_name: "Bash",
    input: { command: "ffmpeg -i clip.mp4 out.mp4" },
    permission_suggestions: [
      {
        type: "addRules",
        rules: [{ toolName: "Bash", ruleContent: "ffmpeg:*" }],
        behavior: "allow",
        destination: "localSettings",
      },
    ],
  },
});

/** The board's API on a test workspace, finding only the fake agents. */
const makeServer = async (t: TestWorkspace, fakes: FakeAgents) => {
  // Route handlers read their services per request, as `serve` does from the server's context.
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      RunRegistry.layer(undefined),
      ImportRuns.layer,
      FetchHttpClient.layer,
      BunHttpPlatform.layer,
      Layer.succeed(DesktopData, Option.none()),
    ).pipe(Layer.provideMerge(t.layer), Layer.provideMerge(fakes.layer)),
  );

  const context = await runtime.context();
  const app = routes({}).pipe(Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer)));
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });

  const post = (path: string, body: Schema.JsonObject) =>
    web.handler(
      new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      context,
    );

  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };

  return { runtime, post, dispose };
};

let t: TestWorkspace;

let fakes: FakeAgents;

let server: Awaited<ReturnType<typeof makeServer>>;

beforeEach(async () => {
  t = await makeWorkspace("Approvals");
  fakes = await makeFakeAgents();
  server = await makeServer(t, fakes);

  // A Claude that asks once, keeps the answer it reads back, then finishes.
  await fakes.bin(
    "claude",
    `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '${REQUEST}'
IFS= read -r answer; printf '%s\\n' "$answer" > "${fakes.calls}/answer"
echo '{"type":"result","subtype":"success","session_id":"sess-1","result":"Done."}'
`,
  );
});

afterEach(async () => {
  // Stops any agent still running before the workspace is removed.
  await server.dispose();
  await fakes.remove();
  await t.remove();
});

const post = (path: string, body: Schema.JsonObject) => server.post(path, body);

/** The item's run events up to its end, and the first request it puts to the board. */
const watch = async (id: string) => {
  const asked = Promise.withResolvers<RunEvent>();
  const listening = Promise.withResolvers<void>();

  const events = server.runtime.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const subscription = yield* (yield* RunRegistry).subscribe(id);
        listening.resolve();

        return yield* Stream.runCollect(
          subscription.events.pipe(
            Stream.tap((event) =>
              Effect.sync(() => (event.type === "approval" ? asked.resolve(event) : undefined)),
            ),
            Stream.takeUntil((event) => event.type === "done" || event.type === "error"),
          ),
        );
      }),
    ),
  );

  await listening.promise;

  return { asked: asked.promise, events };
};

test("a board edit puts Claude's request on the board and takes the answer back to it", async () => {
  await post("/api/items", { title: "Clip" });
  const run = await watch("clip");

  await post("/api/item/edit?id=clip", { agent: "claude", body: "Cut the clip" });

  expect(await run.asked).toEqual({
    type: "approval",
    id: "r1",
    tool: "Bash",
    detail: "ffmpeg -i clip.mp4 out.mp4",
    always: true,
    rules: ["Bash(ffmpeg:*)"],
  });

  const answered = await post("/api/item/edit/approval?id=clip", {
    request: "r1",
    answer: "allow",
  });

  expect(answered.status).toBe(200);
  expect(await answered.json()).toEqual({ answered: true });
  expect((await run.events).map((event) => event.type)).toEqual([
    "start",
    "approval",
    "approval-settled",
    "done",
  ]);

  const reply = JSON.parse(await readFile(join(fakes.calls, "answer"), "utf8"));

  expect(reply.response).toMatchObject({
    request_id: "r1",
    response: { behavior: "allow", updatedInput: { command: "ffmpeg -i clip.mp4 out.mp4" } },
  });

  // Once settled, a second answer goes nowhere.
  const late = await post("/api/item/edit/approval?id=clip", { request: "r1", answer: "deny" });

  expect(await late.json()).toEqual({ answered: false });
});

test("takes only the answers the board offers", async () => {
  const unknown = await post("/api/item/edit/approval?id=clip", { request: "r1", answer: "maybe" });

  expect(unknown.status).toBe(400);

  const unnamed = await post("/api/item/edit/approval?id=clip", { answer: "allow" });

  expect(unnamed.status).toBe(400);
});
