import { describe, expect, test } from "bun:test";

import type { Feedback, RunMessage } from "../web/src/api.ts";
import { closingReply, NO_RUN, reduceRun, type LiveRun } from "../web/src/lib/run.ts";
import {
  describeTarget,
  NO_TARGET,
  targetOf,
  withEnd,
  withoutRange,
  withRange,
  withRegion,
  withStart,
} from "../web/src/lib/target.ts";

const BOX = { x: 0.1, y: 0.2, w: 0.3, h: 0.4, at: 4 };

const boxAt = (time: string) => `box at ${time}`;

describe("edit target", () => {
  test("a range is ordered and rounded to a tenth of a second", () => {
    expect(withRange(NO_TARGET, 5.04, 3.16)).toEqual({ start: 3.2, end: 5 });
    expect(withRange(NO_TARGET, 2.01, 2.04)).toEqual({ start: 2 });
    expect(withRange(NO_TARGET, -1, 1)).toEqual({ start: 0, end: 1 });
  });

  test("in keeps a later out point and drops an earlier one", () => {
    const range = withRange(NO_TARGET, 2, 6);

    expect(withStart(range, 3)).toEqual({ start: 3, end: 6 });
    expect(withStart(range, 7)).toEqual({ start: 7 });
  });

  test("out without an in point starts the range at 0:00, and swaps when before it", () => {
    expect(withEnd(NO_TARGET, 4)).toEqual({ start: 0, end: 4 });
    expect(withEnd({ start: 5 }, 2)).toEqual({ start: 2, end: 5 });
  });

  test("range and box change independently", () => {
    const boxed = withRegion(withRange(NO_TARGET, 1, 3), BOX);

    expect(boxed).toEqual({ start: 1, end: 3, region: BOX });
    expect(withRange(boxed, 5)).toEqual({ start: 5, region: BOX });
    expect(withoutRange(boxed)).toEqual({ region: BOX });
    expect(withRegion(boxed, undefined)).toEqual({ start: 1, end: 3 });
  });

  test("describes what a request points at", () => {
    expect(describeTarget({ start: 3.2, end: 5 }, boxAt)).toBe("0:03.2–0:05.0");
    expect(describeTarget({ start: 63 }, boxAt)).toBe("1:03.0");
    expect(describeTarget({ start: 1, end: 2, region: BOX }, boxAt)).toBe(
      "0:01.0–0:02.0 · box at 0:04.0",
    );
    expect(describeTarget(NO_TARGET, boxAt)).toBe("");
  });

  test("reads the target back from a saved request", () => {
    const feedback: Feedback = {
      id: "f1",
      at: "2026-10-12T00:00:00.000Z",
      author: "me",
      body: "Brighter",
      timecode: 1,
      end: 2,
      region: BOX,
      status: "open",
    };

    expect(targetOf(feedback)).toEqual({ start: 1, end: 2, region: BOX });
  });
});

const fold = (messages: ReadonlyArray<RunMessage>, from: LiveRun = NO_RUN) =>
  messages.reduce(reduceRun, from);

describe("run transcript", () => {
  test("collects steps and the reply", () => {
    const run = fold([
      { type: "run", subject: "f1" },
      { type: "start", subject: "f1", agent: "claude" },
      { type: "text", text: "Trimming the intro." },
      { type: "tool", name: "Bash", detail: "ffmpeg -i in.mp4" },
      { type: "done", reply: "Trimmed 0.4s." },
    ]);

    expect(run).toEqual({
      subject: "f1",
      agent: "claude",
      status: "done",
      steps: [
        { kind: "text", text: "Trimming the intro." },
        { kind: "tool", name: "Bash", detail: "ffmpeg -i in.mp4" },
      ],
      reply: "Trimmed 0.4s.",
    });
  });

  test("a reconnect replays the run instead of appending it twice", () => {
    const replay: ReadonlyArray<RunMessage> = [
      { type: "run", subject: "f1" },
      { type: "start", subject: "f1", agent: "codex" },
      { type: "text", text: "Working." },
    ];

    expect(fold(replay, fold(replay)).steps).toEqual([{ kind: "text", text: "Working." }]);
  });

  test("a new run on the same stream starts over", () => {
    const first = fold([
      { type: "start", subject: "f1", agent: "claude" },
      { type: "error", error: "exit 1" },
    ]);

    expect(first.status).toBe("failed");
    expect(first.error).toBe("exit 1");

    const second = fold([{ type: "start", subject: "f2", agent: "claude" }], first);

    expect(second).toEqual({ subject: "f2", agent: "claude", status: "running", steps: [] });
    expect(fold([{ type: "stopped" }], second).status).toBe("stopped");
  });

  test("moves a reply the last text step already said out of the steps", () => {
    const tool = { kind: "tool", name: "Bash" } as const;

    expect(closingReply([tool, { kind: "text", text: "Done. " }, tool], "Done.")).toEqual({
      steps: [tool, tool],
      reply: "Done.",
    });
    expect(closingReply([{ kind: "text", text: "Looking." }], "Done.")).toEqual({
      steps: [{ kind: "text", text: "Looking." }],
      reply: "Done.",
    });
    expect(closingReply([tool], "  ")).toEqual({ steps: [tool], reply: undefined });
  });
});
