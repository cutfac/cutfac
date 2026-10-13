import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import { createItem, importMedia } from "../src/core/items.ts";
import { reviewMedia, sampleTimes, sheetArgs } from "../src/core/review.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

describe("review layout", () => {
  test("samples from the first frame to the last, never past it", () => {
    const times = sampleTimes(2, 30);

    expect(times).toHaveLength(12);
    expect(times[0]).toBe(0);
    expect(times.at(-1)).toBe(1.96);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
  });

  test("a clip shorter than the sample count keeps each time once", () => {
    expect(sampleTimes(0.05, 30)).toEqual([0, 0.01]);
  });

  test("lays phone frames six to a row and wide ones four", () => {
    const shots = Array.from({ length: 7 }, (_, i) => ({ t: i, file: `frames/${i}.jpg` }));

    expect(sheetArgs("/r", shots, true).join(" ")).toContain("tile=6x2");
    expect(sheetArgs("/r", shots, false).join(" ")).toContain("tile=4x2");
    expect(sheetArgs("/r", shots.slice(0, 3), true).join(" ")).toContain("tile=3x1");
  });
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

/** A 3s 180×320 video: a test pattern, then a hard cut to red at 1.5s. */
function makeCutVideo(path: string): void {
  const generated = Bun.spawnSync(
    [
      "ffmpeg",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=180x320:rate=30:duration=1.5",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:size=180x320:rate=30:duration=1.5",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0",
      "-pix_fmt",
      "yuv420p",
      path,
    ],
    { stderr: "pipe" },
  );

  if (generated.exitCode !== 0) throw new Error(generated.stderr.toString());
}

describe("reviewing an item's video", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace("review");
  });

  afterEach(() => t.remove());

  const addVideo = () => {
    const source = join(t.root, "cut.mp4");
    makeCutVideo(source);

    return Effect.gen(function* () {
      const item = yield* createItem({ title: "Cut" });
      const media = yield* importMedia(item.id, source, "cut.mp4");

      return { id: item.id, file: media.name };
    });
  };

  test.skipIf(!hasFfmpeg)(
    "renders frames, a sheet, and a strip across the cut, and replaces them on the next run",
    async () => {
      const { first, again } = await t.run(
        Effect.gen(function* () {
          const { id, file } = yield* addVideo();
          const review = yield* reviewMedia(id, file);
          const rerun = yield* reviewMedia(id, file, { times: [0, 2], transitions: [] });

          return { first: review, again: rerun };
        }),
      );

      expect(first.dir).toMatch(/\/review\/\[9x16\] cut$/);
      expect(first.notes).toEqual([]);
      expect(first.frames).toHaveLength(12);
      expect(first.sheet).toBe("sheet.jpg");
      expect(first.strips).toHaveLength(1);
      expect(first.strips[0]?.t).toBeCloseTo(1.5, 1);

      expect(again.frames.map((frame) => frame.t)).toEqual([0, 2]);
      expect(again.strips).toEqual([]);

      const abs = join(t.root, again.dir);

      expect((await readdir(join(abs, "frames"))).toSorted()).toEqual([
        "t000.00.jpg",
        "t002.00.jpg",
      ]);
      expect(await readdir(join(abs, "strips"))).toEqual([]);
      expect(await Bun.file(join(abs, "sheet.jpg")).exists()).toBe(true);
    },
    30_000,
  );

  test.skipIf(!hasFfmpeg)(
    "refuses a file the item lacks and a time outside the video",
    async () => {
      const { missing, outside } = await t.run(
        Effect.gen(function* () {
          const { id, file } = yield* addVideo();

          return {
            missing: yield* Effect.flip(reviewMedia(id, "nope.mp4")),
            outside: yield* Effect.flip(reviewMedia(id, file, { times: [5] })),
          };
        }),
      );

      expect(missing).toBeInstanceOf(NotFound);
      expect(outside).toBeInstanceOf(InvalidRequest);
      expect(outside.message).toContain("5s");
    },
    30_000,
  );
});
