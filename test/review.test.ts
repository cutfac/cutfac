import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import { createItem, getItem, importMedia } from "../src/core/items.ts";
import { runChecked } from "../src/core/process.ts";
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
import { SafeZone } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("review"));

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
    expect(safeZoneOf(1080, 1920)).toEqual(Option.some(VERTICAL_SAFE_ZONE));
    expect(safeZoneOf(180, 320)).toEqual(Option.some(VERTICAL_SAFE_ZONE));
    expect(safeZoneOf(1080, 1350)).toEqual(Option.none());
    expect(safeZoneOf(1080, 1080)).toEqual(Option.none());
    expect(safeZoneOf(1920, 1080)).toEqual(Option.none());
  });

  test("clears every platform's interface on vertical video", () => {
    expect(VERTICAL_SAFE_ZONE).toEqual({ top: 0.15, bottom: 0.35, left: 0.06, right: 0.15 });
  });

  test("dims the four margins and outlines the clear area between them", () => {
    const dim = "color=black@0.45:t=fill";

    expect(safeZoneFilters({ top: 0.15, bottom: 0.35, left: 0.06, right: 0.15 })).toEqual([
      `drawbox=x=0:y=0:w=iw:h=ih*0.15:${dim}`,
      `drawbox=x=0:y=ih*(1-0.35):w=iw:h=ih*0.35:${dim}`,
      `drawbox=x=0:y=ih*0.15:w=iw*0.06:h=ih*(1-0.15-0.35):${dim}`,
      `drawbox=x=iw*(1-0.15):y=ih*0.15:w=iw*0.15:h=ih*(1-0.15-0.35):${dim}`,
      "drawbox=x=iw*0.06:y=ih*0.15:w=iw*(1-0.06-0.15):h=ih*(1-0.15-0.35):color=yellow@0.9:t=2",
    ]);
  });

  test("reads reviews saved before the sides were shaded", () => {
    const old = Schema.decodeSync(SafeZone)({ top: 0.12, bottom: 0.2 });

    expect(old).toEqual({ top: 0.12, bottom: 0.2, left: 0, right: 0 });
  });

  test("the checklist names the margins only when the frames show them", () => {
    const review = { file: "v.mp4", at: "", frames: [], strips: [], notes: [] };
    const plain = reviewChecklist(review);
    const shaded = reviewChecklist({ ...review, safeZone: VERTICAL_SAFE_ZONE });

    expect(shaded).toHaveLength(plain.length + 1);
    expect(shaded.join(" ")).toContain(
      "15% at the top, 35% at the bottom, 6% on the left, and 15% on the right",
    );
    expect(plain.join(" ")).not.toContain("margins");
  });
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

const liveWithFfmpeg: typeof it.live = hasFfmpeg ? it.live : (name) => test.skip(name, () => {});

/** A 3s 180×320 video: a test pattern, then a hard cut to red at 1.5s. */
const makeCutVideo = (path: string) =>
  runChecked("ffmpeg", [
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
  ]);

/** The red channel of `file`, `y` of the way down and `x` of the way across. */
const redAt = Effect.fnUntraced(function* (file: string, y: number, x = 0.5) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "ffmpeg",
          [
            "-v",
            "error",
            "-i",
            file,
            "-vf",
            `format=rgb24,crop=1:1:(iw-1)*${x}:(ih-1)*${y}`,
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "-",
          ],
          { stdin: "ignore" },
        ),
      );

      const [pixels, stderr, code] = yield* Effect.all(
        [
          Stream.runCollect(handle.stdout),
          Stream.mkString(Stream.decodeText(handle.stderr)),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      if (code !== 0) return yield* Effect.die(new Error(stderr));

      return pixels[0]?.[0] ?? 0;
    }),
  );
});

const addVideo = Effect.gen(function* () {
  const ws = yield* Workspace;
  const source = join(ws.root, "cut.mp4");

  yield* makeCutVideo(source);

  const item = yield* createItem({ title: "Cut" });
  const media = yield* importMedia(item.id, source, "cut.mp4");

  return { id: item.id, file: media.name };
});

describe("reviewing an item's video", () => {
  liveWithFfmpeg(
    "renders frames, a sheet, and a strip across the cut, and replaces them on the next run",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;
        const { id, file } = yield* addVideo;
        const first = yield* reviewMedia(id, file);
        const again = yield* reviewMedia(id, file, { times: [0, 2], transitions: [] });

        expect(first.dir).toMatch(/\/review\/\[9x16\] cut$/);
        expect(first.notes).toEqual([]);
        expect(first.frames).toHaveLength(12);
        expect(first.sheet).toBe("sheet.jpg");
        expect(first.strips).toHaveLength(1);
        expect(first.strips[0]?.t).toBeCloseTo(1.5, 1);

        expect(again.frames.map((frame) => frame.t)).toEqual([0, 2]);
        expect(again.strips).toEqual([]);

        const abs = join(ws.root, again.dir);

        expect((yield* fs.readDirectory(join(abs, "frames"))).toSorted()).toEqual([
          "t000.00.jpg",
          "t002.00.jpg",
        ]);
        expect(yield* fs.readDirectory(join(abs, "strips"))).toEqual([]);
        expect(yield* fs.exists(join(abs, "sheet.jpg"))).toBe(true);
      }),
    30_000,
  );

  liveWithFfmpeg(
    "dims the safe zone on vertical frames unless asked not to",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;
        const { id, file } = yield* addVideo;

        const once = (safeZones?: boolean) =>
          reviewMedia(id, file, { times: [2], transitions: [], safeZones });

        // At 2s the video is solid red, so the red channel shows where the frame was dimmed.
        const shaded = yield* once();
        const frame = join(ws.root, shaded.dir, "frames/t002.00.jpg");
        const middle = yield* redAt(frame, 0.5);

        expect(shaded.safeZone).toEqual(VERTICAL_SAFE_ZONE);
        expect(yield* redAt(frame, 0.05)).toBeLessThan(middle - 60);
        expect(yield* redAt(frame, 0.95)).toBeLessThan(middle - 60);
        expect(yield* redAt(frame, 0.5, 0.02)).toBeLessThan(middle - 60);
        expect(yield* redAt(frame, 0.5, 0.95)).toBeLessThan(middle - 60);

        const clean = yield* once(false);

        expect(clean.safeZone).toBeUndefined();
        expect(Math.abs((yield* redAt(frame, 0.05)) - (yield* redAt(frame, 0.5)))).toBeLessThan(20);
      }),
    30_000,
  );

  liveWithFfmpeg(
    "lists the last review of each video still in the item, for the board",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;
        const { id, file } = yield* addVideo;
        const review = yield* reviewMedia(id, file);
        const item = yield* getItem(id);

        yield* ws.writeText(
          `${item.dir}/review/gone/review.yaml`,
          "file: gone.mp4\nat: x\nframes: []\nstrips: []\nnotes: []\n",
        );
        yield* ws.writeText(`${item.dir}/review/broken/review.yaml`, "frames: nope\n");

        const listed = yield* listReviews(item);

        expect(listed).toHaveLength(1);
        expect(listed[0]).toEqual(review);
        expect(review.file).toBe("[9x16] cut.mp4");
        expect(Number.isNaN(Date.parse(review.at))).toBe(false);
      }),
    30_000,
  );

  liveWithFfmpeg(
    "refuses a file the item lacks and a time outside the video",
    () =>
      Effect.gen(function* () {
        const { id, file } = yield* addVideo;
        const missing = yield* Effect.flip(reviewMedia(id, "nope.mp4"));
        const outside = yield* Effect.flip(reviewMedia(id, file, { times: [5] }));

        expect(missing).toBeInstanceOf(NotFound);
        expect(outside).toBeInstanceOf(InvalidRequest);
        expect(outside.message).toContain("5s");
      }),
    30_000,
  );
});
