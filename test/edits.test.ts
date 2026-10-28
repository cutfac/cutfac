import { describe, expect, test } from "bun:test";

import { Schema } from "effect";

import { clipArgs, drawboxFilter, frameArgs } from "../src/core/editContext.ts";
import { describeTarget, formatTimecode } from "../src/core/editPrompt.ts";
import { baselineMillis } from "../src/core/editSnapshots.ts";
import { Feedback, FeedbackInput } from "../src/core/schema.ts";

const base = { id: "a", at: "2026-01-01T00:00:00Z", body: "x" };

const decodeFeedback = Schema.decodeUnknownSync(Feedback);

describe("edit targets", () => {
  test("accepts a range with a region", () => {
    const f = decodeFeedback({
      ...base,
      timecode: 1.5,
      end: 3,
      region: { x: 0.1, y: 0.2, w: 0.5, h: 0.3, at: 2 },
    });

    expect([f.end, f.status, f.author]).toEqual([3, "open", "you"]);
    expect(describeTarget(f)).toBe(
      "0:01.5–0:03.0 (1.5s to 3s); region x 10%, y 20%, 50% wide, 30% tall of the frame at 2s",
    );
  });

  test("rejects an empty or reversed range and a box outside the frame", () => {
    expect(() => decodeFeedback({ ...base, timecode: 3, end: 3 })).toThrow();
    expect(() => decodeFeedback({ ...base, end: 3 })).toThrow();
    expect(() => decodeFeedback({ ...base, timecode: -1 })).toThrow();
    expect(() =>
      decodeFeedback({ ...base, region: { x: 0.8, y: 0, w: 0.5, h: 0.5, at: 0 } }),
    ).toThrow();
    expect(() => Schema.decodeSync(FeedbackInput)({ body: "x", timecode: 2, end: 1 })).toThrow();
  });

  test("keeps the legacy point timecode", () => {
    expect(describeTarget(decodeFeedback({ ...base, timecode: 4 }))).toBe("at 0:04.0 (4s)");
    expect(describeTarget(decodeFeedback(base))).toBe("the whole file");
  });

  test("counts a request's changes from when work on it began", () => {
    const f = decodeFeedback(base);
    const later = "2026-01-01T00:05:00Z";

    expect(baselineMillis(f)).toBe(Date.parse(base.at));
    expect(baselineMillis({ ...f, baseline: later })).toBe(Date.parse(later));
  });

  test("formats timecodes as minutes and tenths", () => {
    expect([0, 4, 75.25, 600].map(formatTimecode)).toEqual([
      "0:00.0",
      "0:04.0",
      "1:15.3",
      "10:00.0",
    ]);
  });

  test("builds ffmpeg arguments in frame-relative units", () => {
    expect(drawboxFilter({ x: 0.1, y: 0.2, w: 0.5, h: 0.25, at: 0 })).toBe(
      "drawbox=x=iw*0.1000:y=ih*0.2000:w=iw*0.5000:h=ih*0.2500:color=red@0.9:t=8",
    );
    expect(clipArgs("in.mp4", "out.mp4", 1.5, 4).slice(0, 6)).toEqual([
      "-ss",
      "1.5",
      "-i",
      "in.mp4",
      "-t",
      "2.500",
    ]);
    expect(clipArgs("in.mp4", "out.mp4", 2)[5]).toBe("3.000");
    expect(frameArgs("in.png", "out.png")).toEqual(["-i", "in.png", "-frames:v", "1", "out.png"]);
  });
});
