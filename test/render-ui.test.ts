import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import {
  renderedName,
  renderShare,
  shellRender,
  spanTime,
  timeLeft,
  type RenderState,
} from "../web/src/lib/render.ts";

const state = (overrides: Partial<RenderState>): RenderState => ({
  item: "clip",
  command: "npx remotion render",
  cwd: "",
  status: "running",
  progress: { stage: "preparing" },
  startedAt: 0,
  log: [],
  ...overrides,
});

const halfThrough = (stage: RenderState["progress"]["stage"]) =>
  Option.getOrThrow(renderShare(state({ progress: { stage, percent: 0.5 } })));

describe("a render's share done", () => {
  test("weighs each stage, with drawing frames most of it", () => {
    expect(halfThrough("preparing")).toBeCloseTo(0.05);
    expect(halfThrough("frames")).toBeCloseTo(0.45);
    expect(halfThrough("encoding")).toBeCloseTo(0.9);
  });

  test("an ffmpeg render's time is the whole of it", () => {
    const progress = { stage: "encoding", unit: "seconds", percent: 0.3 } as const;

    expect(renderShare(state({ progress }))).toEqual(Option.some(0.3));
  });

  test("is whole once done, and unknown before any percentage", () => {
    expect(renderShare(state({ status: "done" }))).toEqual(Option.some(1));
    expect(renderShare(state({}))).toEqual(Option.none());
  });
});

describe("timing a render", () => {
  test("guesses the time left only once it has gone far enough", () => {
    expect(timeLeft(10_000, Option.some(0.25))).toEqual(Option.some(30_000));
    expect(timeLeft(10_000, Option.some(0.01))).toEqual(Option.none());
    expect(timeLeft(10_000, Option.some(1))).toEqual(Option.none());
  });

  test("reads as minutes, and hours past an hour", () => {
    expect(spanTime(5_400)).toBe("0:05");
    expect(spanTime(92_000)).toBe("1:32");
    expect(spanTime(3_723_000)).toBe("1:02:03");
  });
});

const step = (detail: string) => ({ kind: "tool", name: "Bash", detail }) as const;

describe("a render the agent runs in its shell", () => {
  test("is the command the running agent waits on, when it renders", () => {
    const steps = [step("ls"), step("npx remotion render MyComp out/v.mp4")];

    expect(shellRender(steps, true)).toEqual(Option.some("npx remotion render MyComp out/v.mp4"));
    expect(shellRender([step("ffmpeg -i a.mp4 b.mp4")], true)).toEqual(
      Option.some("ffmpeg -i a.mp4 b.mp4"),
    );
  });

  test("is nothing once the run ends or moves on", () => {
    const steps = [step("npx remotion render MyComp"), { kind: "text", text: "Done" } as const];

    expect(shellRender([step("npx remotion render MyComp")], false)).toEqual(Option.none());
    expect(shellRender(steps, true)).toEqual(Option.none());
    expect(shellRender([step("npx remotion studio")], true)).toEqual(Option.none());
  });

  test("is nothing for a quick ffmpeg check or a single frame", () => {
    expect(shellRender([step("which ffmpeg && ffmpeg -version")], true)).toEqual(Option.none());
    expect(shellRender([step("ffmpeg -ss 2 -i v.mp4 -frames:v 1 f.png")], true)).toEqual(
      Option.none(),
    );
  });
});

describe("the file a render wrote", () => {
  test("is named within the item's folder", () => {
    expect(renderedName(state({ output: "items/clip/v2.mp4" }), "items/clip")).toEqual(
      Option.some("v2.mp4"),
    );
    expect(renderedName(state({ output: "v2.mp4" }), "items/clip")).toEqual(Option.some("v2.mp4"));
  });

  test("is nothing when it lands elsewhere or wasn't said", () => {
    expect(renderedName(state({ output: "items/clip/out/v2.mp4" }), "items/clip")).toEqual(
      Option.none(),
    );
    expect(renderedName(state({}), "items/clip")).toEqual(Option.none());
  });
});
