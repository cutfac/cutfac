import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import { createItem, getItem, importMedia } from "../src/core/items.ts";
import {
  VERTICAL_SAFE_ZONE,
  listReviews,
  reviewChecklist,
  reviewMedia,
  safeZoneFilters,
  safeZoneOf,
  sampleTimes,
  sheetArgs,
} from "../src/core/review.ts";
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

describe("safe zones", () => {
  test("only full-screen vertical video has bands under platform UI", () => {
    expect(safeZoneOf(1080, 1920)).toEqual(VERTICAL_SAFE_ZONE);
    expect(safeZoneOf(180, 320)).toEqual(VERTICAL_SAFE_ZONE);
    expect(safeZoneOf(1080, 1350)).toBeUndefined();
    expect(safeZoneOf(1080, 1080)).toBeUndefined();
    expect(safeZoneOf(1920, 1080)).toBeUndefined();
  });

  test("dims the top and bottom bands and lines their inner edges", () => {
    const filters = safeZoneFilters({ top: 0.12, bottom: 0.2 });

    expect(filters).toHaveLength(4);
    expect(filters[0]).toBe("drawbox=x=0:y=0:w=iw:h=ih*0.12:color=black@0.45:t=fill");
    expect(filters[1]).toBe("drawbox=x=0:y=ih*0.8:w=iw:h=ih*0.2:color=black@0.45:t=fill");
    expect(filters[2]).toContain("y=ih*0.12:");
    expect(filters[3]).toContain("y=ih*0.8-2:");
  });

  test("the checklist names the bands only when the frames show them", () => {
    const review = { file: "v.mp4", at: "", frames: [], strips: [], notes: [] };
    const plain = reviewChecklist(review);
    const shaded = reviewChecklist({ ...review, safeZone: VERTICAL_SAFE_ZONE });

    expect(shaded).toHaveLength(plain.length + 1);
    expect(shaded.join(" ")).toContain("top 12% and bottom 20%");
    expect(plain.join(" ")).not.toContain("bands");
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

/** The red channel at the horizontal middle of `file`, `y` of the way down. */
function redAt(file: string, y: number): number {
  const read = Bun.spawnSync(
    [
      "ffmpeg",
      "-v",
      "error",
      "-i",
      file,
      "-vf",
      `format=rgb24,crop=1:1:iw/2:(ih-1)*${y}`,
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-",
    ],
    { stderr: "pipe" },
  );

  if (read.exitCode !== 0) throw new Error(read.stderr.toString());

  return read.stdout[0] ?? 0;
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
    "dims the safe zone on vertical frames unless asked not to",
    async () => {
      const { id, file } = await t.run(addVideo());

      const once = (safeZones?: boolean) =>
        t.run(reviewMedia(id, file, { times: [2], transitions: [], safeZones }));

      // At 2s the video is solid red, so the red channel shows where the frame was dimmed.
      const shaded = await once();
      const frame = join(t.root, shaded.dir, "frames/t002.00.jpg");
      const middle = redAt(frame, 0.5);

      expect(shaded.safeZone).toEqual(VERTICAL_SAFE_ZONE);
      expect(redAt(frame, 0.05)).toBeLessThan(middle - 60);
      expect(redAt(frame, 0.95)).toBeLessThan(middle - 60);

      const clean = await once(false);

      expect(clean.safeZone).toBeUndefined();
      expect(Math.abs(redAt(frame, 0.05) - redAt(frame, 0.5))).toBeLessThan(20);
    },
    30_000,
  );

  test.skipIf(!hasFfmpeg)(
    "lists the last review of each video still in the item, for the board",
    async () => {
      const { review, item } = await t.run(
        Effect.gen(function* () {
          const { id, file } = yield* addVideo();

          return { review: yield* reviewMedia(id, file), item: yield* getItem(id) };
        }),
      );

      const reviews = join(t.root, item.dir, "review");
      await Bun.write(
        join(reviews, "gone/review.yaml"),
        "file: gone.mp4\nat: x\nframes: []\nstrips: []\nnotes: []\n",
      );
      await Bun.write(join(reviews, "broken/review.yaml"), "frames: nope\n");

      const listed = await t.run(listReviews(item));

      expect(listed).toHaveLength(1);
      expect(listed[0]).toEqual(review);
      expect(review.file).toBe("[9x16] cut.mp4");
      expect(Number.isNaN(Date.parse(review.at))).toBe(false);
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
