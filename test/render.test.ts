import { describe, expect, test } from "bun:test";

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
import { Workspace } from "../src/core/workspace.ts";
import { eventually, testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

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
  Effect.gen(function* () {
    const item = yield* createItem({ title: "Clip" });
    const renders = yield* makeRenders;
    yield* renders.start({ item: item.id, command, label: "v2" });

    return Option.getOrThrow(yield* renders.wait(item.id, wait));
  });

const savedRender = (item: string, status: string, owner: number) =>
  Effect.flatMap(Workspace, (ws) =>
    ws.writeText(
      `${RENDERS_DIR}/${encodeURIComponent(item)}.json`,
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
    ),
  );

const GONE_PID = 99_999_999;

describe("running a render", () => {
  it.live("runs to the end and saves how far it got", () =>
    Effect.gen(function* () {
      const state = yield* render(
        "printf 'Codec h264\\nRendered 1/2\\r\\nRendered 2/2\\rEncoded 2/2'",
      );

      expect(state).toMatchObject({
        status: "done",
        code: 0,
        label: "v2",
        progress: { stage: "encoding", done: 2, total: 2 },
        log: ["Codec h264", "Rendered 2/2", "Encoded 2/2"],
      });
      expect(state?.endedAt).toBeNumber();

      const saved = Option.getOrThrow(yield* readRender("clip"));

      expect(saved).toEqual(state);
    }),
  );

  it.live("a failing command fails with what it printed", () =>
    Effect.gen(function* () {
      const state = yield* render("echo 'Error: no composition named Foo' >&2; exit 3");

      expect(state).toMatchObject({ status: "failed", code: 3 });
      expect(state?.log).toEqual(["Error: no composition named Foo"]);
    }),
  );

  it.live("hands back where it stands when the wait runs out", () =>
    Effect.gen(function* () {
      const state = yield* render("echo 'Rendered 1/9'; sleep 5", "1500 millis");

      expect(state).toMatchObject({ status: "running", progress: { done: 1, total: 9 } });
    }),
  );

  it.live("stops when the board asks", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Clip" });
      const renders = yield* makeRenders;

      yield* renders.start({ item: item.id, command: "echo started; sleep 30" });
      yield* eventually(
        Effect.map(
          renders.current(item.id),
          Option.exists((now) => now.log.includes("started")),
        ),
      );
      yield* requestStop(item.id);

      const state = Option.getOrThrow(yield* renders.wait(item.id, "5 seconds"));

      expect(state?.status).toBe("stopped");
    }),
  );

  it.live("won't start a second render of the same item", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Clip" });
      const renders = yield* makeRenders;

      yield* renders.start({ item: item.id, command: "sleep 30" });

      const error = yield* Effect.flip(renders.start({ item: item.id, command: "sleep 30" }));

      expect(error).toBeInstanceOf(Conflict);
    }),
  );

  it.live("of two starts at once, only one runs", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Clip" });
      const renders = yield* makeRenders;
      const start = renders.start({ item: item.id, command: "sleep 30" });

      const error = yield* Effect.flip(Effect.all([start, start], { concurrency: 2 }));

      expect(error).toBeInstanceOf(Conflict);
    }),
  );

  it.live("a render whose process is gone reads as stopped", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* createItem({ title: "Clip" });
      yield* ws.writeText(
        `${RENDERS_DIR}/clip.json`,
        JSON.stringify({
          item: "clip",
          command: "npx remotion render",
          cwd: "",
          status: "running",
          progress: { stage: "frames" },
          startedAt: 1,
          log: [],
          owner: GONE_PID,
        }),
      );

      const state = Option.getOrThrow(yield* readRender("clip"));

      expect(state?.status).toBe("stopped");
      expect(state?.endedAt).toBeNumber();
    }),
  );

  it.live("lists only the renders still going on", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* savedRender("b clip", "running", process.pid);
      yield* savedRender("a clip", "running", process.pid);
      yield* savedRender("done", "done", process.pid);
      yield* savedRender("gone", "running", GONE_PID);
      yield* ws.writeText(`${RENDERS_DIR}/a clip.stop`, "");

      expect(yield* runningRenders()).toEqual(["a clip", "b clip"]);
    }),
  );
});
