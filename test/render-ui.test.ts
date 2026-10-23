import { describe, expect, test } from "bun:test";

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

describe("a render's share done", () => {
  test("weighs each stage, with drawing frames most of it", () => {
    expect(renderShare(state({ progress: { stage: "preparing", percent: 0.5 } }))).toBeCloseTo(
      0.05,
    );
    expect(renderShare(state({ progress: { stage: "frames", percent: 0.5 } }))).toBeCloseTo(0.45);
    expect(renderShare(state({ progress: { stage: "encoding", percent: 0.5 } }))).toBeCloseTo(0.9);
  });

  test("an ffmpeg render's time is the whole of it", () => {
    const progress = { stage: "encoding", unit: "seconds", percent: 0.3 } as const;

    expect(renderShare(state({ progress }))).toBe(0.3);
  });

  test("is whole once done, and unknown before any percentage", () => {
    expect(renderShare(state({ status: "done" }))).toBe(1);
    expect(renderShare(state({}))).toBeUndefined();
  });
});

describe("timing a render", () => {
  test("guesses the time left only once it has gone far enough", () => {
    expect(timeLeft(10_000, 0.25)).toBe(30_000);
    expect(timeLeft(10_000, 0.01)).toBeUndefined();
    expect(timeLeft(10_000, 1)).toBeUndefined();
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

    expect(shellRender(steps, true)).toBe("npx remotion render MyComp out/v.mp4");
    expect(shellRender([step("ffmpeg -i a.mp4 b.mp4")], true)).toBe("ffmpeg -i a.mp4 b.mp4");
  });

  test("is nothing once the run ends or moves on", () => {
    const steps = [step("npx remotion render MyComp"), { kind: "text", text: "Done" } as const];

    expect(shellRender([step("npx remotion render MyComp")], false)).toBeUndefined();
    expect(shellRender(steps, true)).toBeUndefined();
    expect(shellRender([step("npx remotion studio")], true)).toBeUndefined();
  });

  test("is nothing for a quick ffmpeg check or a single frame", () => {
    expect(shellRender([step("which ffmpeg && ffmpeg -version")], true)).toBeUndefined();
    expect(shellRender([step("ffmpeg -ss 2 -i v.mp4 -frames:v 1 f.png")], true)).toBeUndefined();
  });
});

describe("the file a render wrote", () => {
  test("is named within the item's folder", () => {
    expect(renderedName(state({ output: "items/clip/v2.mp4" }), "items/clip")).toBe("v2.mp4");
    expect(renderedName(state({ output: "v2.mp4" }), "items/clip")).toBe("v2.mp4");
  });

  test("is nothing when it lands elsewhere or wasn't said", () => {
    expect(renderedName(state({ output: "items/clip/out/v2.mp4" }), "items/clip")).toBeUndefined();
    expect(renderedName(state({}), "items/clip")).toBeUndefined();
  });
});
