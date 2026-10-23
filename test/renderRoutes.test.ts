import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { Layer, ManagedRuntime } from "effect";
import { HttpRouter } from "effect/http";

import { createItem } from "../src/core/items.ts";
import { RENDERS_DIR } from "../src/core/render.ts";
import { renderRoutes } from "../src/server/render.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

/** The render routes on a test workspace. */
const makeServer = async (t: TestWorkspace) => {
  const runtime = ManagedRuntime.make(t.layer);
  const context = await runtime.context();

  const web = HttpRouter.toWebHandler(
    renderRoutes.pipe(Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer))),
    { disableLogger: true },
  );

  const send = (path: string, init: RequestInit = {}) =>
    web.handler(new Request(`http://localhost${path}`, init), context);

  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };

  return { send, dispose };
};

let t: TestWorkspace;

let server: Awaited<ReturnType<typeof makeServer>>;

beforeEach(async () => {
  t = await makeWorkspace("Render routes");
  server = await makeServer(t);
  await t.run(createItem({ title: "Clip" }));
});

afterEach(async () => {
  await server.dispose();
  await t.remove();
});

/** A render of `clip` this test process is running, as the MCP server would save it. */
const saveRunning = async () => {
  await mkdir(join(t.root, RENDERS_DIR), { recursive: true });
  await writeFile(
    join(t.root, RENDERS_DIR, "clip.json"),
    JSON.stringify({
      item: "clip",
      command: "npx remotion render",
      cwd: "",
      status: "running",
      progress: { stage: "frames", done: 12, total: 60, unit: "frames", percent: 0.2 },
      startedAt: 1,
      log: ["Rendered 12/60"],
      owner: process.pid,
    }),
  );
};

/** The first `render` event the stream sends. */
const firstRender = async (response: Response) => {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";

  while (true) {
    const chunk = await reader.read();

    if (chunk.done) break;

    text += decoder.decode(chunk.value);
    const event = /event: render\ndata: (.*)\n/.exec(text);

    if (event?.[1] !== undefined) {
      await reader.cancel();

      return JSON.parse(event[1]);
    }
  }

  throw new Error(`no render event in ${text}`);
};

test("streams null while the item has no render", async () => {
  const response = await server.send("/api/item/render?id=clip");

  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(await firstRender(response)).toBeNull();
});

test("streams the render the agent saves", async () => {
  await saveRunning();

  const render = await firstRender(await server.send("/api/item/render?id=clip"));

  expect(render).toMatchObject({ status: "running", progress: { done: 12, total: 60 } });
});

test("refuses an item that isn't there", async () => {
  const response = await server.send("/api/item/render?id=missing");

  expect(response.status).toBe(404);
});

test("stopping leaves a note for the process running it", async () => {
  await saveRunning();

  const response = await server.send("/api/item/render/stop?id=clip", { method: "POST" });

  expect(response.status).toBe(200);
  expect(await Bun.file(join(t.root, RENDERS_DIR, "clip.stop")).exists()).toBe(true);
});
