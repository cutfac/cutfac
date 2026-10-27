import { describe, expect } from "bun:test";
import { join } from "node:path";

import { Effect, Fiber, FileSystem, Layer, Queue, Schema, Stream } from "effect";

import type { RunEvent } from "../src/core/agentParse.ts";
import { Feedback } from "../src/core/schema.ts";
import { testEffect } from "./effect.ts";
import { type BoardServer, boardServer, decodedOf, jsonOf } from "./routeSupport.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Line"), fakeAgents));

const ended = (event: RunEvent) =>
  event.type === "done" || event.type === "error" || event.type === "stopped";

const Prompt = Schema.fromJsonString(
  Schema.Struct({ message: Schema.Struct({ content: Schema.String }) }),
);

describe("routes", () => {
  it.live("queues an edit request with a copyable prompt", () =>
    Effect.gen(function* () {
      const { send, sendJson } = yield* boardServer();

      yield* sendJson("POST", "/api/items", { title: "Hook", hook: "Wait for it" });

      const edit = yield* sendJson("POST", "/api/item/edit?id=hook", {
        agent: "queue",
        body: "Make the first second punchier",
      });

      expect(edit.status).toBe(200);

      const queued = yield* decodedOf(
        Schema.Struct({ feedbackId: Schema.String, sent: Schema.String, prompt: Schema.String }),
        edit,
      );

      expect(queued.sent).toBe("queue");
      expect(queued.prompt).toContain("Request: Make the first second punchier");

      const prompt = yield* send(`/api/item/edit/prompt?id=hook&feedbackId=${queued.feedbackId}`);

      expect(yield* jsonOf(prompt)).toEqual({ prompt: queued.prompt });

      const stop = yield* sendJson("POST", "/api/item/edit/stop?id=hook", {});

      expect(yield* jsonOf(stop)).toEqual({ ok: true, stopped: false });

      const blank = yield* sendJson("POST", "/api/item/edit?id=hook", {
        agent: "queue",
        body: "",
      });

      expect(blank.status).toBe(400);
    }),
  );
});

const fakeClaude = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const fs = yield* FileSystem.FileSystem;

  yield* fakes.bin(
    "claude",
    `n=$(ls "${fakes.calls}" | grep -c stdin)
call="${fakes.calls}/$n"
printf '%s\n' "$@" > "$call.args"
head -n 1 > "$call.stdin"
while [ ! -f "${fakes.dir}/release" ]; do sleep 0.02; done
echo '{"type":"system","subtype":"init","session_id":"sess-'$n'"}'
if grep -q 'This one fails' "$call.stdin"; then echo 'boom' >&2; exit 1; fi
echo '{"type":"result","subtype":"success","session_id":"sess-'$n'","result":"Done."}'
`,
  );

  return { release: Effect.orDie(fs.writeFileString(join(fakes.dir, "release"), "")) };
});

const recorded = (kind: "stdin" | "args") =>
  Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const fs = yield* FileSystem.FileSystem;

    const names = (yield* fs.readDirectory(fakes.calls))
      .filter((name) => name.endsWith(`.${kind}`))
      .toSorted((a, b) => parseInt(a) - parseInt(b));

    return yield* Effect.forEach(names, (name) => fs.readFileString(join(fakes.calls, name)));
  }).pipe(Effect.orDie);

const asked = Effect.gen(function* () {
  const lines = yield* recorded("stdin");

  return yield* Effect.forEach(lines, (line) =>
    Effect.map(
      Schema.decodeEffect(Prompt)(line),
      ({ message }) => /^Request: (.*)$/m.exec(message.content)?.[1],
    ),
  );
}).pipe(Effect.orDie);

const flagged = (flag: string) =>
  Effect.map(recorded("args"), (calls) =>
    calls.map((args) => {
      const lines = args.split("\n");
      const at = lines.indexOf(flag);

      return at === -1 ? undefined : lines[at + 1];
    }),
  );

const endings = Effect.fnUntraced(function* (server: BoardServer, id: string, total: number) {
  const { events } = yield* server.runs.subscribe(id);
  const seen = yield* Queue.unbounded<RunEvent["type"]>();

  yield* events.pipe(
    Stream.filter(ended),
    Stream.take(total),
    Stream.runForEach((event) => Effect.asVoid(Queue.offer(seen, event.type))),
    Effect.forkScoped,
  );

  return seen;
});

const ask = Effect.fnUntraced(function* (
  server: BoardServer,
  body: string,
  settings: Schema.JsonObject = {},
) {
  const response = yield* server.sendJson("POST", "/api/item/edit?id=clip", {
    agent: "claude",
    body,
    ...settings,
  });

  return yield* decodedOf(
    Schema.Struct({ feedbackId: Schema.String, sent: Schema.String, item: Schema.Unknown }),
    response,
  );
});

describe("an item's waiting line", () => {
  it.live(
    "requests made while the agent works run after it, in order, and wait after a failure",
    () =>
      Effect.gen(function* () {
        const { release } = yield* fakeClaude;
        const server = yield* boardServer();

        yield* server.sendJson("POST", "/api/items", { title: "Clip" });

        const first = yield* ask(server, "First");
        const second = yield* ask(server, "Second. This one fails");
        const third = yield* ask(server, "Third");
        const dropped = yield* ask(server, "Dropped");

        expect([first.sent, second.sent, third.sent]).toEqual(["claude", "claude", "claude"]);
        expect(second.item).toMatchObject({
          running: true,
          doc: {
            feedback: [{ body: "First" }, { body: "Second. This one fails", waiting: "claude" }],
          },
        });

        const reworded = yield* server.sendJson("POST", "/api/item/edit/reword?id=clip", {
          feedbackId: third.feedbackId,
          body: "Third, louder",
        });

        expect(reworded.status).toBe(200);

        const cancelled = yield* server.sendJson("POST", "/api/item/edit/cancel?id=clip", {
          feedbackId: dropped.feedbackId,
        });

        expect(yield* jsonOf(cancelled)).toMatchObject({ doc: { feedback: { length: 3 } } });

        const running = yield* server.sendJson("POST", "/api/item/edit/reword?id=clip", {
          feedbackId: first.feedbackId,
          body: "Too late",
        });

        expect(running.status).toBe(400);

        const after = yield* endings(server, "clip", 3);

        yield* release;

        const firstTwo = yield* Queue.takeN(after, 2);

        expect(firstTwo).toEqual(["done", "error"]);
        expect(yield* jsonOf(yield* server.send("/api/item?id=clip"))).toMatchObject({
          running: false,
          doc: {
            feedback: [
              { run: { status: "done" } },
              { run: { status: "failed" } },
              { body: "Third, louder", waiting: "claude" },
            ],
          },
        });

        const continued = yield* server.send("/api/item/edit/continue?id=clip", {
          method: "POST",
        });

        expect(yield* jsonOf(continued)).toEqual({ ok: true });
        expect([...firstTwo, yield* Queue.take(after)]).toEqual(["done", "error", "done"]);
        expect(yield* asked).toEqual(["First", "Second. This one fails", "Third, louder"]);

        const idle = yield* server.send("/api/item/edit/continue?id=clip", { method: "POST" });

        expect(idle.status).toBe(400);
      }),
  );

  it.live("a request runs on the model and effort it was sent with, also after waiting", () =>
    Effect.gen(function* () {
      const { release } = yield* fakeClaude;
      const server = yield* boardServer();

      yield* server.sendJson("POST", "/api/items", { title: "Clip" });

      const refused = yield* server.sendJson("POST", "/api/item/edit?id=clip", {
        agent: "claude",
        body: "Sneaky",
        model: "--dangerously-skip-permissions",
      });

      expect(refused.status).toBe(400);

      const first = yield* ask(server, "First", { model: "sonnet" });
      const second = yield* ask(server, "Second", { model: "opus", effort: "high" });

      expect(second.item).toMatchObject({
        doc: {
          feedback: [{ body: "First" }, { waiting: "claude", model: "opus", effort: "high" }],
        },
      });

      const { events } = yield* server.runs.subscribe("clip");

      const starts = yield* events.pipe(
        Stream.filter((event) => event.type === "start"),
        Stream.take(2),
        Stream.runCollect,
        Effect.forkScoped,
      );

      const after = yield* endings(server, "clip", 2);

      yield* release;

      expect(yield* Queue.takeN(after, 2)).toEqual(["done", "done"]);
      expect(yield* Fiber.join(starts)).toMatchObject([
        { subject: first.feedbackId, model: "sonnet" },
        { subject: second.feedbackId, model: "opus", effort: "high" },
      ]);
      expect(yield* flagged("--model")).toEqual(["sonnet", "opus"]);
      expect(yield* flagged("--effort")).toEqual([undefined, "high"]);

      const item = yield* jsonOf(yield* server.send("/api/item?id=clip"));

      expect(item).toMatchObject({
        doc: {
          feedback: [
            { id: first.feedbackId, run: { model: "sonnet", status: "done" } },
            { id: second.feedbackId, run: { model: "opus", effort: "high", status: "done" } },
          ],
        },
      });

      const { doc } = yield* Schema.decodeUnknownEffect(
        Schema.Struct({ doc: Schema.Struct({ feedback: Schema.Array(Feedback) }) }),
      )(item);

      const waited = doc.feedback[1];

      expect([waited?.waiting, waited?.model, waited?.effort]).toEqual([
        undefined,
        undefined,
        undefined,
      ]);
    }),
  );
});
