import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, Option, Schema } from "effect";

import { InvalidRequest } from "../src/core/errors.ts";
import { createItem, importMedia } from "../src/core/items.ts";
import {
  aspectFromName,
  aspectOf,
  checkVideo,
  parseProbe,
  parseShowinfoTimes,
  toMediaFiles,
} from "../src/core/media.ts";
import { frameTimes } from "../src/core/preprocess.ts";
import { FormatDoc } from "../src/core/schema.ts";
import { verifyItem } from "../src/core/verify.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

describe("media names", () => {
  test("reads the aspect prefix", () => {
    expect(aspectFromName("[9x16] video.mp4")).toEqual(Option.some("9x16"));
    expect(aspectFromName("[3x4] 01-cover.jpg")).toEqual(Option.some("3x4"));
    expect(aspectFromName("[2x3] odd.jpg")).toEqual(Option.none());
    expect(aspectFromName("video.mp4")).toEqual(Option.none());
  });

  test("keeps only media files", () => {
    const files = toMediaFiles([
      { name: "[9x16] video.mp4", dir: false, size: 1, mtime: 1 },
      { name: "notes.md", dir: false, size: 1, mtime: 1 },
      { name: "frames", dir: true, size: 0, mtime: 1 },
      { name: "cover.PNG", dir: false, size: 1, mtime: 1 },
    ]);

    expect(files.map((f) => [f.name, f.kind, f.aspect])).toEqual([
      ["[9x16] video.mp4", "video", "9x16"],
      ["cover.PNG", "image", undefined],
    ]);
  });

  test("matches a frame size to a listed aspect within 2%", () => {
    expect(aspectOf(1080, 1920)).toEqual(Option.some("9x16"));
    expect(aspectOf(1080, 1350)).toEqual(Option.some("4x5"));
    expect(aspectOf(1000, 1000)).toEqual(Option.some("1x1"));
    expect(aspectOf(1000, 1500)).toEqual(Option.none());
    expect(aspectOf(0, 1920)).toEqual(Option.none());
  });
});

const probeJson = {
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      width: 1080,
      height: 1920,
      avg_frame_rate: "30000/1001",
      start_time: "0.000000",
    },
    { codec_type: "audio", codec_name: "aac", start_time: "0.000000" },
  ],
  format: { duration: "21.5" },
};

describe("probe checks", () => {
  test("parses ffprobe output", () => {
    expect(parseProbe(probeJson)).toEqual({
      duration: 21.5,
      width: 1080,
      height: 1920,
      fps: 29.97,
      hasAudio: true,
      videoCodec: "h264",
      audioCodec: "aac",
      videoStart: 0,
      audioStart: 0,
    });
  });

  test("passes a clean 9:16 master", () => {
    const checks = checkVideo(parseProbe(probeJson), { aspect: "9x16" });

    expect(checks.every((c) => c.ok)).toBe(true);
  });

  test("flags missing audio, low resolution, drift, and format rules", () => {
    const silent = parseProbe({
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          width: 720,
          height: 1280,
          avg_frame_rate: "24/1",
        },
      ],
      format: { duration: "70" },
    });

    const format = Schema.decodeSync(FormatDoc)({
      title: "t",
      summary: "s",
      fps: 30,
      duration: { min: 10, max: 45 },
    });

    const failed = checkVideo(silent, { aspect: "9x16", format }).flatMap((c) =>
      c.ok ? [] : [c.name],
    );

    expect(failed).toEqual(["resolution", "audio", "fps", "duration"]);

    const [video] = probeJson.streams;

    const drift = parseProbe({
      ...probeJson,
      streams: [
        ...(video === undefined ? [] : [video]),
        { codec_type: "audio", codec_name: "aac", start_time: "0.2" },
      ],
    });

    expect(checkVideo(drift, {}).find((c) => c.name === "stream start")?.ok).toBe(false);
  });
});

describe("video preprocessing", () => {
  test("parses showinfo cut times", () => {
    const stderr =
      "[Parsed_showinfo_1 @ 0x1] n:0 pts:1 pts_time:1.234 duration\n[Parsed_showinfo_1] n:1 pts_time:5.5 ";

    expect(parseShowinfoTimes(stderr)).toEqual([1.23, 5.5]);
  });

  test("samples the hook densely", () => {
    expect(frameTimes(6.2)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]);
    expect(frameTimes(1.2)).toEqual([0, 0.5, 1]);
    // ffmpeg has no frame to seek to at the very end.
    expect(frameTimes(2)).toEqual([0, 0.5, 1, 1.5]);
  });
});

const hasFfmpeg = Bun.which("ffmpeg") !== null && Bun.which("ffprobe") !== null;

/** A 2s 180×320 test pattern with a tone, so it probes as a 9:16 video with audio. */
function makeVideo(path: string): void {
  const generated = Bun.spawnSync(
    [
      "ffmpeg",
      "-v",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=180x320:rate=30:duration=2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:duration=2",
      "-pix_fmt",
      "yuv420p",
      "-shortest",
      path,
    ],
    { stderr: "pipe" },
  );

  if (generated.exitCode !== 0) throw new Error(generated.stderr.toString());
}

describe("media in a workspace", () => {
  let t: TestWorkspace;
  let source: string;

  beforeEach(async () => {
    t = await makeWorkspace();
    source = join(t.root, "upload.mp4");
  });

  afterEach(() => t.remove());

  test("refuses to import a file that is not media", async () => {
    await Bun.write(join(t.root, "notes.txt"), "hi");

    const error = await t.fail(
      Effect.flatMap(createItem({ title: "Clip" }), (item) =>
        importMedia(item.id, join(t.root, "notes.txt"), "notes.txt"),
      ),
    );

    expect(error).toBeInstanceOf(InvalidRequest);
  });

  test.skipIf(!hasFfmpeg)(
    "imports uploads with a probed aspect tag and unique names, then verifies them",
    async () => {
      makeVideo(source);

      const { first, second, reports } = await t.run(
        Effect.gen(function* () {
          const item = yield* createItem({ title: "Clip" });
          const a = yield* importMedia(item.id, source, "[1x1] My Clip.mp4");
          const b = yield* importMedia(item.id, source, "My Clip.mp4");

          return { first: a, second: b, reports: yield* verifyItem(item.id) };
        }),
      );

      expect(first.name).toBe("[9x16] My Clip.mp4");
      expect(second.name).toBe("[9x16] My Clip-2.mp4");
      expect(reports.map((report) => report.file)).toEqual([
        "[9x16] My Clip-2.mp4",
        "[9x16] My Clip.mp4",
      ]);
      expect(reports[0]?.checks.find((check) => check.name === "audio")?.ok).toBe(true);
      // 180×320 is far below upload resolution.
      expect(reports[0]?.checks.find((check) => check.name === "resolution")?.ok).toBe(false);
    },
    20_000,
  );
});
