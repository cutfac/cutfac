import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { Layer, ManagedRuntime, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { RunRegistry } from "../src/core/agentRun.ts";
import { parseRange, routes } from "../src/server/app.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

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

describe("routes", () => {
  let t: TestWorkspace;
  let handler: (request: Request) => Promise<Response>;
  let dispose: () => Promise<void>;

  beforeEach(async () => {
    t = await makeWorkspace("Routes");

    // Route handlers read their services per request, as `serve` does from the server's context.
    const runtime = ManagedRuntime.make(
      Layer.mergeAll(RunRegistry.layer, FetchHttpClient.layer, BunHttpPlatform.layer).pipe(
        Layer.provideMerge(t.layer),
      ),
    );

    const context = await runtime.context();
    const app = routes({}).pipe(Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer)));
    const web = HttpRouter.toWebHandler(app, { disableLogger: true });

    handler = (request) => web.handler(request, context);

    dispose = async () => {
      await web.dispose();
      await runtime.dispose();
    };
  });

  afterEach(async () => {
    await dispose();
    await t.remove();
  });

  const send = (path: string, init: RequestInit = {}) =>
    handler(new Request(`http://localhost${path}`, init));

  const sendJson = (method: string, path: string, body: Schema.JsonObject) =>
    send(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

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
});
