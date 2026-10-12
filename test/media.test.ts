import { describe, expect, test } from "bun:test";
import { aspectFromName, checkVideo, parseProbe, toMediaFiles } from "../src/core/media.ts";
import { frameTimes, parseShowinfoTimes } from "../src/core/references.ts";
import { FormatDoc } from "../src/core/schema.ts";

describe("media names", () => {
  test("reads the aspect prefix", () => {
    expect(aspectFromName("[9x16] video.mp4")).toBe("9x16");
    expect(aspectFromName("[3x4] 01-cover.jpg")).toBe("3x4");
    expect(aspectFromName("[2x3] odd.jpg")).toBeUndefined();
    expect(aspectFromName("video.mp4")).toBeUndefined();
  });

  test("keeps only media files", () => {
    const files = toMediaFiles([
      { name: "[9x16] video.mp4", dir: false, size: 1, mtime: 1 },
      { name: "POSTING.md", dir: false, size: 1, mtime: 1 },
      { name: "frames", dir: true, size: 0, mtime: 1 },
      { name: "cover.PNG", dir: false, size: 1, mtime: 1 },
    ]);
    expect(files.map((f) => [f.name, f.kind, f.aspect])).toEqual([
      ["[9x16] video.mp4", "video", "9x16"],
      ["cover.PNG", "image", undefined],
    ]);
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
    const format = FormatDoc.parse({
      title: "t",
      summary: "s",
      fps: 30,
      duration: { min: 10, max: 45 },
    });
    const failed = checkVideo(silent, { aspect: "9x16", format })
      .filter((c) => !c.ok)
      .map((c) => c.name);
    expect(failed).toEqual(["resolution", "audio", "fps", "duration"]);

    const drift = parseProbe({
      ...probeJson,
      streams: [
        probeJson.streams[0]!,
        { codec_type: "audio", codec_name: "aac", start_time: "0.2" },
      ],
    });
    expect(checkVideo(drift, {}).find((c) => c.name === "stream start")?.ok).toBe(false);
  });
});

describe("reference preprocessing", () => {
  test("parses showinfo cut times", () => {
    const stderr =
      "[Parsed_showinfo_1 @ 0x1] n:0 pts:1 pts_time:1.234 duration\n[Parsed_showinfo_1] n:1 pts_time:5.5 ";
    expect(parseShowinfoTimes(stderr)).toEqual([1.23, 5.5]);
  });

  test("samples the hook densely", () => {
    expect(frameTimes(6.2)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6]);
    expect(frameTimes(1.2)).toEqual([0, 0.5, 1]);
  });
});
