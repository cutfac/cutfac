import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { Effect, Layer, ManagedRuntime, Schema, Stream } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { type RunEvent, RunRegistry } from "../src/core/agentRun.ts";
import { ImportRuns } from "../src/core/importRun.ts";
import { createImport } from "../src/core/imports.ts";
import type { Feedback } from "../src/core/schema.ts";
import { parseRange, routes } from "../src/server/app.ts";
import { type FakeAgents, makeFakeAgents, makeWorkspace, type TestWorkspace } from "./support.ts";

describe("parseRange", () => {
  test("reads one byte range against the file size", () => {
    expect(parseRange(undefined, 10)).toEqual({ kind: "whole" });
    expect(parseRange("bytes=2-5", 10)).toEqual({ kind: "slice", start: 2, end: 5 });
    expect(parseRange("bytes=4-", 10)).toEqual({ kind: "slice", start: 4, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ kind: "slice", start: 7, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ kind: "slice", start: 8, end: 9 });
  });

  test("gives the whole file for headers it does not understand", () => {
    expect(parseRange("bytes=0-1,4-5", 10)).toEqual({ kind: "whole" });
    expect(parseRange("items=0-1", 10)).toEqual({ kind: "whole" });
    expect(parseRange("bytes=-", 10)).toEqual({ kind: "whole" });
  });

  test("refuses ranges past the end", () => {
    expect(parseRange("bytes=10-", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5-2", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 10)).toEqual({ kind: "unsatisfiable" });
  });
});

const ended = (event: RunEvent) =>
  event.type === "done" || event.type === "error" || event.type === "stopped";

/** The board's API on a test workspace, finding only the fake agents. */
const makeServer = async (t: TestWorkspace, fakes: FakeAgents) => {
  // Route handlers read their services per request, as `serve` does from the server's context.
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      RunRegistry.layer,
      ImportRuns.layer,
      FetchHttpClient.layer,
      BunHttpPlatform.layer,
    ).pipe(Layer.provideMerge(t.layer), Layer.provideMerge(fakes.layer)),
  );

  const context = await runtime.context();
  const app = routes({}).pipe(Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer)));
  const web = HttpRouter.toWebHandler(app, { disableLogger: true });

  const send = (path: string, init: RequestInit = {}) =>
    web.handler(new Request(`http://localhost${path}`, init), context);

  const sendJson = (method: string, path: string, body: Schema.JsonObject) =>
    send(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };

  return { runtime, send, sendJson, dispose };
};

type Server = Awaited<ReturnType<typeof makeServer>>;

describe("routes", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let server: Server;

  beforeEach(async () => {
    t = await makeWorkspace("Routes");
    fakes = await makeFakeAgents();
    server = await makeServer(t, fakes);
  });

  afterEach(async () => {
    await server.dispose();
    await fakes.remove();
    await t.remove();
  });

  const send = (path: string, init: RequestInit = {}) => server.send(path, init);

  const sendJson = (method: string, path: string, body: Schema.JsonObject) =>
    server.sendJson(method, path, body);

  const upload = (id: string, file: File) => {
    const form = new FormData();
    form.append("file", file);

    return send(`/api/item/media?id=${id}`, { method: "POST", body: form });
  };

  test("health and unknown API routes", async () => {
    const health = await send("/api/health");

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });

    const missing = await send("/api/nope");

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "No such API route" });
  });

  test("creates, lists, patches, and reads an item", async () => {
    const created = await sendJson("POST", "/api/items", { title: "First cut" });

    expect(created.status).toBe(200);
    expect(await created.json()).toMatchObject({ id: "first-cut", running: false });

    const listed = await send("/api/items");

    expect(await listed.json()).toMatchObject([{ id: "first-cut", status: "idea" }]);

    const patched = await sendJson("PATCH", "/api/item?id=first-cut", { status: "review" });

    expect(await patched.json()).toMatchObject({ doc: { status: "review" } });

    const read = await send("/api/item?id=first-cut");

    expect(await read.json()).toMatchObject({ id: "first-cut", doc: { title: "First cut" } });
  });

  test("lists every format with what it lacks, and makes items with its inputs", async () => {
    await mkdir(join(t.root, "formats/art"), { recursive: true });
    await writeFile(
      join(t.root, "formats/art/format.yaml"),
      "title: Art\nrequires: [surely-not-installed-cf]\ninputs:\n  - id: style\n    title: Style\n    choices: [{ id: swiss, title: Swiss }, { id: neon, title: Neon }]\n    default: swiss\n",
    );
    await mkdir(join(t.root, "formats/broken"), { recursive: true });
    await writeFile(join(t.root, "formats/broken/format.yaml"), "summary: no title\n");

    const statuses = await send("/api/formats/status");

    expect(await statuses.json()).toMatchObject([
      {
        id: "art",
        format: { doc: { title: "Art" } },
        check: {
          ready: false,
          problems: [{ kind: "program", subject: "surely-not-installed-cf" }],
        },
      },
      { id: "broken", check: { ready: false, problems: [{ kind: "spec" }] } },
    ]);

    const created = await sendJson("POST", "/api/items", {
      title: "Openings",
      format: "art",
      inputs: { style: "neon" },
    });

    expect(await created.json()).toMatchObject({ doc: { inputs: { style: "neon" } } });

    const wrong = await sendJson("POST", "/api/items", {
      title: "Endgames",
      format: "art",
      inputs: { style: "pastel" },
    });

    expect(wrong.status).toBe(400);
  });

  test("undoes and redoes item changes", async () => {
    await sendJson("POST", "/api/items", { title: "Cut" });

    const patched = await sendJson("PATCH", "/api/item?id=cut", { title: "Final cut" });

    expect(await patched.json()).toMatchObject({
      doc: { title: "Final cut" },
      history: { cursor: 1, entries: [{ kind: "details", after: { title: "Final cut" } }] },
    });

    const undone = await sendJson("POST", "/api/item/history/undo?id=cut", {});

    expect(await undone.json()).toMatchObject({ doc: { title: "Cut" }, history: { cursor: 0 } });

    const again = await sendJson("POST", "/api/item/history/undo?id=cut", {});

    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: "Nothing to undo" });

    const redone = await sendJson("POST", "/api/item/history/redo?id=cut", {});

    expect(await redone.json()).toMatchObject({ doc: { title: "Final cut" } });

    const start = await sendJson("POST", "/api/item/history/goto?id=cut", {});

    expect(await start.json()).toMatchObject({ doc: { title: "Cut" } });

    const missing = await sendJson("POST", "/api/item/history/version?id=cut", { versionId: "x" });

    expect(missing.status).toBe(404);
  });

  test("maps failures to statuses with a message", async () => {
    const missing = await send("/api/item?id=missing");

    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: "Item not found: missing" });

    const blank = await sendJson("POST", "/api/items", { title: "  " });

    expect(blank.status).toBe(400);

    const malformed = await send("/api/items", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    expect(malformed.status).toBe(400);
    expect((await send("/api/item")).status).toBe(400);
  });

  test("uploads media and refuses files that are not media", async () => {
    await sendJson("POST", "/api/items", { title: "Clip" });

    // Not a real video, so it probes to no aspect and keeps its name.
    const video = await upload("clip", new File([new Uint8Array([0, 1, 2])], "take 1.mp4"));

    expect(video.status).toBe(200);
    expect(await video.json()).toMatchObject({
      doc: { status: "drafting" },
      media: [{ name: "take 1.mp4", kind: "video" }],
    });

    const text = await upload("clip", new File(["hi"], "notes.txt"));

    expect(text.status).toBe(400);
  });

  test("queues an edit request with a copyable prompt", async () => {
    await sendJson("POST", "/api/items", { title: "Hook", hook: "Wait for it" });

    const edit = await sendJson("POST", "/api/item/edit?id=hook", {
      agent: "queue",
      body: "Make the first second punchier",
    });

    expect(edit.status).toBe(200);

    // SAFETY: the edit route answers with these fields.
    const queued = (await edit.json()) as { feedbackId: string; sent: string; prompt: string };

    expect(queued.sent).toBe("queue");
    expect(queued.prompt).toContain("Request: Make the first second punchier");

    const prompt = await send(`/api/item/edit/prompt?id=hook&feedbackId=${queued.feedbackId}`);

    expect(await prompt.json()).toEqual({ prompt: queued.prompt });

    const stop = await sendJson("POST", "/api/item/edit/stop?id=hook", {});

    expect(await stop.json()).toEqual({ ok: true, stopped: false });

    const blank = await sendJson("POST", "/api/item/edit?id=hook", { agent: "queue", body: "" });

    expect(blank.status).toBe(400);
  });

  test("serves workspace files with byte ranges and refuses everything else", async () => {
    await mkdir(join(t.root, "items/clip"), { recursive: true });
    await writeFile(
      join(t.root, "items/clip/[9x16] video.mp4"),
      new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    );

    const path = `/files/${encodeURIComponent("items/clip/[9x16] video.mp4")}`;
    const whole = await send(path);

    expect(whole.status).toBe(200);
    expect(whole.headers.get("content-type")).toBe("video/mp4");
    expect(whole.headers.get("accept-ranges")).toBe("bytes");
    expect((await whole.arrayBuffer()).byteLength).toBe(10);

    const slice = await send(path, { headers: { range: "bytes=2-5" } });

    expect(slice.status).toBe(206);
    expect(slice.headers.get("content-range")).toBe("bytes 2-5/10");
    expect([...new Uint8Array(await slice.arrayBuffer())]).toEqual([2, 3, 4, 5]);

    const past = await send(path, { headers: { range: "bytes=20-" } });

    expect(past.status).toBe(416);
    expect(past.headers.get("content-range")).toBe("bytes */10");

    expect((await send("/files/factory.yaml")).status).toBe(403);
    expect((await send(`/files/${encodeURIComponent("../outside.mp4")}`)).status).toBe(403);
    expect((await send("/files/items/clip/missing.mp4")).status).toBe(404);
  });

  test("lists, reads, and closes imports, and starts none without knowing its own launch", async () => {
    expect(await (await send("/api/imports")).json()).toEqual([]);
    expect((await send("/api/import?id=zzz")).status).toBe(404);

    const link = "https://example.com/pack";
    const refused = await sendJson("POST", "/api/imports", { link, agent: "claude" });

    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({
      error: expect.stringContaining("copy the import prompt"),
    });
    expect(await (await send("/api/imports")).json()).toEqual([]);

    const { id } = await t.run(createImport({ link, agent: "claude" }));
    const blank = await sendJson("POST", `/api/import/reply?id=${id}`, { body: "  " });

    expect(await blank.json()).toMatchObject({ error: "Write a reply first" });
    expect((await sendJson("POST", `/api/import/reply?id=${id}`, { allow: true })).status).toBe(
      400,
    );

    expect(await (await send(`/api/import?id=${id}`)).json()).toMatchObject({
      id,
      running: false,
      doc: { link, allowed: false, closed: false },
    });

    const stopped = await send(`/api/import/stop?id=${id}`, { method: "POST" });

    expect(await stopped.json()).toMatchObject({ id, running: false });

    const closed = await send(`/api/import/close?id=${id}`, { method: "POST" });

    expect(await closed.json()).toMatchObject({ id, running: false, doc: { closed: true } });
  });
});

describe("an item's waiting line", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;
  let server: Server;

  beforeEach(async () => {
    t = await makeWorkspace("Line");
    fakes = await makeFakeAgents();
    server = await makeServer(t, fakes);
  });

  afterEach(async () => {
    // Stops any agent still running before the workspace is removed.
    await server.dispose();
    await fakes.remove();
    await t.remove();
  });

  /**
   * A `claude` that records its prompt and flags, holds until the test lets it go, then answers
   * in stream-json, or fails partway when the request says so.
   */
  const fakeClaude = () =>
    fakes.bin(
      "claude",
      `n=$(ls "${fakes.calls}" | grep -c stdin)
call="${fakes.calls}/$n"
printf '%s\n' "$@" > "$call.args"
cat > "$call.stdin"
while [ ! -f "${fakes.dir}/release" ]; do sleep 0.02; done
echo '{"type":"system","subtype":"init","session_id":"sess-'$n'"}'
if grep -q 'This one fails' "$call.stdin"; then echo 'boom' >&2; exit 1; fi
echo '{"type":"result","subtype":"success","session_id":"sess-'$n'","result":"Done."}'
`,
    );

  /** What each call recorded in its `.kind` file, oldest first. */
  const recorded = async (kind: "stdin" | "args") => {
    const names = (await readdir(fakes.calls))
      .filter((name) => name.endsWith(`.${kind}`))
      .toSorted((a, b) => parseInt(a) - parseInt(b));

    return Promise.all(names.map((name) => readFile(join(fakes.calls, name), "utf8")));
  };

  /** The request each call was about, oldest first. */
  const asked = async () =>
    (await recorded("stdin")).map((prompt) => /^Request: (.*)$/m.exec(prompt)?.[1]);

  /** The value after `flag` in each call's arguments, oldest first. */
  const flagged = async (flag: string) =>
    (await recorded("args")).map((args) => {
      const lines = args.split("\n");
      const at = lines.indexOf(flag);

      return at === -1 ? undefined : lines[at + 1];
    });

  /**
   * Listens for the next `total` run endings on the item; the returned function resolves once
   * `count` of them have come.
   */
  const endings = async (id: string, total: number) => {
    const seen: Array<RunEvent["type"]> = [];
    let changed = Promise.withResolvers<void>();
    const listening = Promise.withResolvers<void>();

    void server.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const runs = yield* RunRegistry;
          const { events } = yield* runs.subscribe(id);
          listening.resolve();

          yield* events.pipe(
            Stream.filter(ended),
            Stream.take(total),
            Stream.runForEach((event) =>
              Effect.sync(() => {
                seen.push(event.type);
                changed.resolve();
                changed = Promise.withResolvers();
              }),
            ),
          );
        }),
      ),
    );

    await listening.promise;

    return async (count: number) => {
      while (seen.length < count) await changed.promise;

      return seen.slice(0, count);
    };
  };

  const ask = async (body: string, settings: Schema.JsonObject = {}) => {
    const response = await server.sendJson("POST", "/api/item/edit?id=clip", {
      agent: "claude",
      body,
      ...settings,
    });

    // SAFETY: the edit route answers with these fields.
    return (await response.json()) as { feedbackId: string; sent: string; item: unknown };
  };

  test("requests made while the agent works run after it, in order, and wait after a failure", async () => {
    await fakeClaude();
    await server.sendJson("POST", "/api/items", { title: "Clip" });

    const first = await ask("First");
    const second = await ask("Second. This one fails");
    const third = await ask("Third");
    const dropped = await ask("Dropped");

    expect([first.sent, second.sent, third.sent]).toEqual(["claude", "claude", "claude"]);
    expect(second.item).toMatchObject({
      running: true,
      doc: { feedback: [{ body: "First" }, { body: "Second. This one fails", waiting: "claude" }] },
    });

    const reworded = await server.sendJson("POST", "/api/item/edit/reword?id=clip", {
      feedbackId: third.feedbackId,
      body: "Third, louder",
    });

    expect(reworded.status).toBe(200);

    const cancelled = await server.sendJson("POST", "/api/item/edit/cancel?id=clip", {
      feedbackId: dropped.feedbackId,
    });

    expect(await cancelled.json()).toMatchObject({ doc: { feedback: { length: 3 } } });

    const running = await server.sendJson("POST", "/api/item/edit/reword?id=clip", {
      feedbackId: first.feedbackId,
      body: "Too late",
    });

    expect(running.status).toBe(400);

    const after = await endings("clip", 3);
    await writeFile(join(fakes.dir, "release"), "");

    expect(await after(2)).toEqual(["done", "error"]);
    expect(await (await server.send("/api/item?id=clip")).json()).toMatchObject({
      running: false,
      doc: {
        feedback: [
          { run: { status: "done" } },
          { run: { status: "failed" } },
          { body: "Third, louder", waiting: "claude" },
        ],
      },
    });

    const continued = await server.send("/api/item/edit/continue?id=clip", { method: "POST" });

    expect(await continued.json()).toEqual({ ok: true });
    expect(await after(3)).toEqual(["done", "error", "done"]);
    expect(await asked()).toEqual(["First", "Second. This one fails", "Third, louder"]);

    const idle = await server.send("/api/item/edit/continue?id=clip", { method: "POST" });

    expect(idle.status).toBe(400);
  });

  test("a request runs on the model and effort it was sent with, also after waiting", async () => {
    await fakeClaude();
    await server.sendJson("POST", "/api/items", { title: "Clip" });

    const refused = await server.sendJson("POST", "/api/item/edit?id=clip", {
      agent: "claude",
      body: "Sneaky",
      model: "--dangerously-skip-permissions",
    });

    expect(refused.status).toBe(400);

    const first = await ask("First", { model: "sonnet" });
    const second = await ask("Second", { model: "opus", effort: "high" });

    expect(second.item).toMatchObject({
      doc: { feedback: [{ body: "First" }, { waiting: "claude", model: "opus", effort: "high" }] },
    });

    const listening = Promise.withResolvers<void>();

    const starts = server.runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { events } = yield* (yield* RunRegistry).subscribe("clip");
          listening.resolve();

          return yield* Stream.runCollect(
            events.pipe(
              Stream.filter((event) => event.type === "start"),
              Stream.take(2),
            ),
          );
        }),
      ),
    );

    await listening.promise;

    const after = await endings("clip", 2);
    await writeFile(join(fakes.dir, "release"), "");

    expect(await after(2)).toEqual(["done", "done"]);
    // The board names the model a run started on while it streams.
    expect(await starts).toMatchObject([
      { subject: first.feedbackId, model: "sonnet" },
      { subject: second.feedbackId, model: "opus", effort: "high" },
    ]);
    expect(await flagged("--model")).toEqual(["sonnet", "opus"]);
    expect(await flagged("--effort")).toEqual([undefined, "high"]);

    const item = await (await server.send("/api/item?id=clip")).json();

    expect(item).toMatchObject({
      doc: {
        feedback: [
          { id: first.feedbackId, run: { model: "sonnet", status: "done" } },
          { id: second.feedbackId, run: { model: "opus", effort: "high", status: "done" } },
        ],
      },
    });

    // SAFETY: the item route answers with the item's document.
    const waited = (item as { doc: { feedback: ReadonlyArray<Feedback> } }).doc.feedback[1];

    expect([waited?.waiting, waited?.model, waited?.effort]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });
});
