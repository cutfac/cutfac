import { expect } from "bun:test";

import { Effect, Option, Schema, Stream } from "effect";
import { Sse } from "effect/encoding";

import { createItem } from "../src/core/items.ts";
import { RENDERS_DIR } from "../src/core/render.ts";
import { Workspace } from "../src/core/workspace.ts";
import { renderRoutes } from "../src/server/render.ts";
import { testEffect } from "./effect.ts";
import { workspaceRoutes } from "./routeSupport.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("Render routes"));

const renderServer = Effect.gen(function* () {
  const server = yield* workspaceRoutes(renderRoutes);

  yield* createItem({ title: "Clip" });

  return server;
});

/** A render of `clip` this test process is running, as the MCP server would save it. */
const saveRunning = Effect.gen(function* () {
  const ws = yield* Workspace;

  yield* ws.writeText(
    `${RENDERS_DIR}/clip.json`,
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
});

const decodeJson = Schema.decodeEffect(Schema.fromJsonString(Schema.Json));

const firstRender = (response: Response) =>
  Stream.fromReadableStream({
    evaluate: () => response.body ?? new ReadableStream(),
    onError: (error) => new Error(`The stream broke: ${String(error)}`),
  }).pipe(
    Stream.decodeText(),
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.filter((event) => event.event === "render"),
    Stream.runHead,
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.die(new Error("The stream ended before a render event")),
        onSome: (event) => decodeJson(event.data),
      }),
    ),
    Effect.orDie,
  );

it.live("streams null while the item has no render", () =>
  Effect.gen(function* () {
    const { send } = yield* renderServer;

    const response = yield* send("/api/item/render?id=clip");

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(yield* firstRender(response)).toBeNull();
  }),
);

it.live("streams the render the agent saves", () =>
  Effect.gen(function* () {
    const { send } = yield* renderServer;

    yield* saveRunning;

    const render = yield* firstRender(yield* send("/api/item/render?id=clip"));

    expect(render).toMatchObject({ status: "running", progress: { done: 12, total: 60 } });
  }),
);

it.live("refuses an item that isn't there", () =>
  Effect.gen(function* () {
    const { send } = yield* renderServer;

    const response = yield* send("/api/item/render?id=missing");

    expect(response.status).toBe(404);
  }),
);

it.live("stopping leaves a note for the process running it", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const { send } = yield* renderServer;

    yield* saveRunning;

    const response = yield* send("/api/item/render/stop?id=clip", { method: "POST" });

    expect(response.status).toBe(200);
    expect(yield* ws.exists(`${RENDERS_DIR}/clip.stop`)).toBe(true);
  }),
);
