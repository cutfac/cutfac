import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Duration, Effect, Option } from "effect";

import { Conflict } from "../src/core/errors.ts";
import { createItem } from "../src/core/items.ts";
import {
  makeRenders,
  readRender,
  RENDERS_DIR,
  requestStop,
  runningRenders,
} from "../src/core/render.ts";
import {
  appendLog,
  plainLine,
  readProgress,
  START_PROGRESS,
  type RenderProgress,
} from "../src/core/renderProgress.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const fold = (lines: ReadonlyArray<string>, from: RenderProgress = START_PROGRESS) =>
  lines.map(plainLine).reduce(readProgress, from);

describe("reading render progress", () => {
  test("follows the Remotion CLI from bundling through encoding", () => {
    expect(fold(["Bundling code ━━━━━━ 42%"])).toEqual({
      stage: "preparing",
      percent: 0.42,
      duration: undefined,
    });

    const frames = fold([
      "Bundled code ━━ 575ms",
      "Codec h264",
      "Rendered 15/60, time remaining: 9s",
    ]);

    expect(frames).toMatchObject({ stage: "frames", done: 15, total: 60, percent: 0.25 });
    expect(fold(["Encoded 60/60"], frames)).toMatchObject({ stage: "encoding", percent: 1 });
  });

  test("measures ffmpeg's time= against the first input's duration", () => {
    const progress = fold([
      "  Duration: 00:00:02.00, start: 0.000000, bitrate: 5 kb/s",
      "  Duration: 00:01:00.00, start: 0.000000",
      "frame=   30 fps=0.0 q=-1.0 size=  1kB time=00:00:01.00 bitrate=1kbits/s",
    ]);

    expect(progress).toMatchObject({ stage: "encoding", done: 1, total: 2, percent: 0.5 });
  });

  test("any other percentage moves the bar without changing the stage", () => {
    expect(fold(["exporting 30% done"])).toMatchObject({ stage: "preparing", percent: 0.3 });
    expect(fold(["over 250% faster"])).toEqual(START_PROGRESS);
  });

  test("a percentage after counted progress leaves the count alone", () => {
    const progress = fold([
      "  Duration: 00:00:02.00, start: 0.000000",
      "frame=   60 fps=0.0 q=-1.0 size=  1kB time=00:00:02.00 bitrate=1kbits/s",
      "[libx264 @ 0x77c5069880] ref B L1: 95.2%  4.8%",
    ]);

    expect(progress).toMatchObject({ stage: "encoding", done: 2, total: 2, percent: 1 });
  });

  test("ignores color codes", () => {
    expect(fold(["\u001b[32mRendered 3/6\u001b[0m"])).toMatchObject({ done: 3, total: 6 });
  });
});

const noLines: ReadonlyArray<string> = [];

describe("keeping a render's log", () => {
  test("a progress line replaces the one before it", () => {
    const log = ["Codec h264", "Rendered 1/60", "Rendered 2/60", "", "Encoded 1/60"].reduce(
      appendLog,
      noLines,
    );

    expect(log).toEqual(["Codec h264", "Rendered 2/60", "Encoded 1/60"]);
  });

  test("keeps only the last lines", () => {
    const log = Array.from({ length: 50 }, (_, n) => `line ${"x".repeat(n)}`).reduce(
      appendLog,
      noLines,
    );

    expect(log).toHaveLength(40);
    expect(log.at(-1)).toBe(`line ${"x".repeat(49)}`);
  });

  test("cuts a line short", () => {
    expect(plainLine(`${"x".repeat(600)}  `)).toHaveLength(500);
  });
});

/** Render `command` on a new item and wait for it. */
const render = (command: string, wait: Duration.Input = "5 seconds") =>
  Effect.scoped(
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Clip" });
      const renders = yield* makeRenders;
      yield* renders.start({ item: item.id, command, label: "v2" });

      return Option.getOrThrow(yield* renders.wait(item.id, wait));
    }),
  );

describe("running a render", () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await makeWorkspace();
  });

  afterEach(() => ws.remove());

  test("runs to the end and saves how far it got", async () => {
    const state = await ws.run(
      render("printf 'Codec h264\\nRendered 1/2\\r\\nRendered 2/2\\rEncoded 2/2'"),
    );

    expect(state).toMatchObject({
      status: "done",
      code: 0,
      label: "v2",
      progress: { stage: "encoding", done: 2, total: 2 },
      log: ["Codec h264", "Rendered 2/2", "Encoded 2/2"],
    });
    expect(state?.endedAt).toBeNumber();

    const saved = Option.getOrThrow(await ws.run(readRender("clip")));

    expect(saved).toEqual(state);
  });

  test("a failing command fails with what it printed", async () => {
    const state = await ws.run(render("echo 'Error: no composition named Foo' >&2; exit 3"));

    expect(state).toMatchObject({ status: "failed", code: 3 });
    expect(state?.log).toEqual(["Error: no composition named Foo"]);
  });

  test("hands back where it stands when the wait runs out", async () => {
    const state = await ws.run(render("echo 'Rendered 1/9'; sleep 5", "1500 millis"));

    expect(state).toMatchObject({ status: "running", progress: { done: 1, total: 9 } });
  });

  test("stops when the board asks", async () => {
    const state = await ws.run(
      Effect.scoped(
        Effect.gen(function* () {
          const item = yield* createItem({ title: "Clip" });
          const renders = yield* makeRenders;
          yield* renders.start({ item: item.id, command: "echo started; sleep 30" });
          yield* Effect.sleep("300 millis");
          yield* requestStop(item.id);

          return Option.getOrThrow(yield* renders.wait(item.id, "5 seconds"));
        }),
      ),
    );

    expect(state?.status).toBe("stopped");
  });

  test("won't start a second render of the same item", async () => {
    const error = await ws.fail(
      Effect.scoped(
        Effect.gen(function* () {
          const item = yield* createItem({ title: "Clip" });
          const renders = yield* makeRenders;
          yield* renders.start({ item: item.id, command: "sleep 30" });

          return yield* renders.start({ item: item.id, command: "sleep 30" });
        }),
      ),
    );

    expect(error).toBeInstanceOf(Conflict);
  });

  test("of two starts at once, only one runs", async () => {
    const error = await ws.fail(
      Effect.scoped(
        Effect.gen(function* () {
          const item = yield* createItem({ title: "Clip" });
          const renders = yield* makeRenders;
          const start = renders.start({ item: item.id, command: "sleep 30" });

          return yield* Effect.all([start, start], { concurrency: 2 });
        }),
      ),
    );

    expect(error).toBeInstanceOf(Conflict);
  });

  test("a render whose process is gone reads as stopped", async () => {
    await ws.run(createItem({ title: "Clip" }));
    await mkdir(join(ws.root, RENDERS_DIR), { recursive: true });
    await writeFile(
      join(ws.root, RENDERS_DIR, "clip.json"),
      JSON.stringify({
        item: "clip",
        command: "npx remotion render",
        cwd: "",
        status: "running",
        progress: { stage: "frames" },
        startedAt: 1,
        log: [],
        // Past the highest pid macOS and Linux hand out.
        owner: 99_999_999,
      }),
    );

    const state = Option.getOrThrow(await ws.run(readRender("clip")));

    expect(state?.status).toBe("stopped");
    expect(state?.endedAt).toBeNumber();
  });

  test("lists only the renders still going on", async () => {
    await mkdir(join(ws.root, RENDERS_DIR), { recursive: true });

    const save = (item: string, status: string, owner: number) =>
      writeFile(
        join(ws.root, RENDERS_DIR, `${encodeURIComponent(item)}.json`),
        JSON.stringify({
          item,
          command: "x",
          cwd: "",
          status,
          progress: { stage: "frames" },
          startedAt: 1,
          log: [],
          owner,
        }),
      );

    await save("b clip", "running", process.pid);
    await save("a clip", "running", process.pid);
    await save("done", "done", process.pid);
    await save("gone", "running", 99_999_999);
    await writeFile(join(ws.root, RENDERS_DIR, "a clip.stop"), "");

    expect(await ws.run(runningRenders())).toEqual(["a clip", "b clip"]);
  });
});
