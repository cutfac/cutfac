import { expect } from "bun:test";
import { join } from "node:path";

import { Deferred, Effect, Fiber, FileSystem, Layer, Schema, Stream } from "effect";

import type { RunEvent } from "../src/core/agentParse.ts";
import { testEffect } from "./effect.ts";
import { type BoardServer, boardServer, jsonOf } from "./routeSupport.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Approvals"), fakeAgents));

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

const claudeAsking = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;

  yield* fakes.bin(
    "claude",
    `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '${REQUEST}'
IFS= read -r answer; printf '%s\\n' "$answer" > "${fakes.calls}/answer"
echo '{"type":"result","subtype":"success","session_id":"sess-1","result":"Done."}'
`,
  );
});

/** The item's run events up to its end, and the first request it puts to the board. */
const watch = Effect.fnUntraced(function* (server: BoardServer, id: string) {
  const asked = yield* Deferred.make<RunEvent>();
  const { events } = yield* server.runs.subscribe(id);

  const collected = yield* events.pipe(
    Stream.tap((event) =>
      event.type === "approval" ? Deferred.succeed(asked, event) : Effect.void,
    ),
    Stream.takeUntil((event) => event.type === "done" || event.type === "error"),
    Stream.runCollect,
    Effect.forkScoped,
  );

  return { asked: Deferred.await(asked), events: Fiber.join(collected) };
});

it.live("a board edit puts Claude's request on the board and takes the answer back to it", () =>
  Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const fs = yield* FileSystem.FileSystem;
    const server = yield* boardServer();
    const { sendJson } = server;

    yield* claudeAsking;
    yield* sendJson("POST", "/api/items", { title: "Clip" });
    const run = yield* watch(server, "clip");

    yield* sendJson("POST", "/api/item/edit?id=clip", { agent: "claude", body: "Cut the clip" });

    expect(yield* run.asked).toEqual({
      type: "approval",
      id: "r1",
      tool: "Bash",
      kind: "command",
      network: false,
      detail: "ffmpeg -i clip.mp4 out.mp4",
      always: true,
      rules: ["Bash(ffmpeg:*)"],
      session: false,
    });

    const answered = yield* sendJson("POST", "/api/item/edit/approval?id=clip", {
      request: "r1",
      answer: "allow",
    });

    expect(answered.status).toBe(200);
    expect(yield* jsonOf(answered)).toEqual({ answered: true });
    expect((yield* run.events).map((event) => event.type)).toEqual([
      "start",
      "approval",
      "approval-settled",
      "done",
    ]);

    const reply = yield* fs
      .readFileString(join(fakes.calls, "answer"))
      .pipe(Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Json))), Effect.orDie);

    expect(reply).toMatchObject({
      response: {
        request_id: "r1",
        response: { behavior: "allow", updatedInput: { command: "ffmpeg -i clip.mp4 out.mp4" } },
      },
    });

    const late = yield* sendJson("POST", "/api/item/edit/approval?id=clip", {
      request: "r1",
      answer: "deny",
    });

    expect(yield* jsonOf(late)).toEqual({ answered: false });
  }),
);

it.live("takes only the answers the board offers", () =>
  Effect.gen(function* () {
    const { sendJson } = yield* boardServer();

    const unknown = yield* sendJson("POST", "/api/item/edit/approval?id=clip", {
      request: "r1",
      answer: "maybe",
    });

    expect(unknown.status).toBe(400);

    const unnamed = yield* sendJson("POST", "/api/item/edit/approval?id=clip", {
      answer: "allow",
    });

    expect(unnamed.status).toBe(400);
  }),
);
