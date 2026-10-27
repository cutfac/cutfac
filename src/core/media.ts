import { Array, Effect, Match, Option, Schema } from "effect";

import { CommandFailed } from "./errors.ts";
import { run, runChecked, tail } from "./process.ts";
import { ASPECTS, type Aspect, type FormatDoc } from "./schema.ts";
import type { Entry } from "./workspace.ts";

const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export type MediaKind = "video" | "image";

export interface MediaFile {
  readonly name: string;
  readonly kind: MediaKind;
  readonly aspect?: Aspect | undefined;
  readonly size: number;
  readonly mtime: number;
}

export function extension(name: string): string {
  const dot = name.lastIndexOf(".");

  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function mediaKind(name: string): Option.Option<MediaKind> {
  const ext = extension(name);

  if (VIDEO_EXT.has(ext)) return Option.some("video");

  if (IMAGE_EXT.has(ext)) return Option.some("image");

  return Option.none();
}

/** `[9x16] cover.jpg` → `9x16`. */
export function aspectFromName(name: string): Option.Option<Aspect> {
  const value = /^\[(\d+x\d+)\]/.exec(name)?.[1];

  return Array.findFirst(ASPECTS, (aspect) => aspect === value);
}

export function toMediaFiles(entries: ReadonlyArray<Entry>): MediaFile[] {
  return entries.flatMap((entry): MediaFile[] => {
    if (entry.dir) return [];

    return Option.toArray(
      Option.map(mediaKind(entry.name), (kind) => ({
        name: entry.name,
        kind,
        aspect: Option.getOrUndefined(aspectFromName(entry.name)),
        size: entry.size,
        mtime: entry.mtime,
      })),
    );
  });
}

export interface MediaProbe {
  readonly duration: number;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly hasAudio: boolean;
  readonly videoCodec?: string | undefined;
  readonly audioCodec?: string | undefined;
  readonly videoStart?: number | undefined;
  readonly audioStart?: number | undefined;
}

const FfprobeStream = Schema.Struct({
  codec_type: Schema.optionalKey(Schema.String),
  codec_name: Schema.optionalKey(Schema.String),
  width: Schema.optionalKey(Schema.Finite),
  height: Schema.optionalKey(Schema.Finite),
  avg_frame_rate: Schema.optionalKey(Schema.String),
  r_frame_rate: Schema.optionalKey(Schema.String),
  start_time: Schema.optionalKey(Schema.String),
});

/** The parts of `ffprobe -print_format json -show_streams -show_format` the checks read. */
export const FfprobeOutput = Schema.Struct({
  streams: Schema.optionalKey(Schema.Array(FfprobeStream)),
  format: Schema.optionalKey(Schema.Struct({ duration: Schema.optionalKey(Schema.String) })),
});

export type FfprobeOutput = typeof FfprobeOutput.Type;

const decodeFfprobe = Schema.decodeUnknownEffect(Schema.fromJsonString(FfprobeOutput));

/** `30000/1001` → `29.97`. */
function parseRate(rate: string | undefined): number {
  const [n = 0, d = 0] = (rate ?? "").split("/").map(Number);

  if (!Number.isFinite(n) || !Number.isFinite(d) || n === 0 || d === 0) return 0;

  return Math.round((n / d) * 100) / 100;
}

const finiteOr = (text: string | undefined, fallback: number) => {
  const value = Number(text);

  return text === undefined || !Number.isFinite(value) ? fallback : value;
};

export function parseProbe(json: FfprobeOutput): MediaProbe {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");

  return {
    duration: finiteOr(json.format?.duration, 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    hasAudio: audio !== undefined,
    videoCodec: video?.codec_name,
    audioCodec: audio?.codec_name,
    videoStart: video?.start_time === undefined ? undefined : finiteOr(video.start_time, 0),
    audioStart: audio?.start_time === undefined ? undefined : finiteOr(audio.start_time, 0),
  };
}

/** Read duration, size, frame rate, and streams of a media file with ffprobe. */
export const probe = Effect.fn("media.probe")(function* (absPath: string) {
  const out = yield* runChecked("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    absPath,
  ]);

  const json = yield* decodeFfprobe(out).pipe(
    Effect.mapError(
      (error) =>
        new CommandFailed({ message: `ffprobe printed unexpected JSON: ${error.message}` }),
    ),
  );

  return parseProbe(json);
});

/** Run ffmpeg quietly, overwriting outputs; fails with CommandFailed on a non-zero exit. */
export const ffmpeg = (args: ReadonlyArray<string>) =>
  Effect.asVoid(runChecked("ffmpeg", ["-y", "-v", "error", ...args]));

/** Parse `pts_time:` values printed by ffmpeg's showinfo filter. */
export function parseShowinfoTimes(stderr: string): number[] {
  return Array.map(
    Array.fromIterable(stderr.matchAll(/pts_time:([\d.]+)/g)),
    (match) => Math.round(Number(match[1]) * 100) / 100,
  );
}

/** Seconds where the picture changes enough to count as a cut, by ffmpeg's scene score. */
export const sceneCuts = Effect.fn("media.sceneCuts")(function* (absPath: string) {
  const result = yield* run("ffmpeg", [
    "-hide_banner",
    "-i",
    absPath,
    "-vf",
    "select='gt(scene,0.3)',showinfo",
    "-f",
    "null",
    "-",
  ]);

  if (result.code !== 0) {
    return yield* new CommandFailed({
      message: `Scene detection failed: ${tail(result.stderr, 2)}`,
    });
  }

  return parseShowinfoTimes(result.stderr);
});

export interface Check {
  readonly name: string;
  readonly ok: boolean;
  readonly detail: string;
}

export const ASPECT_RATIO = {
  "9x16": 9 / 16,
  "4x5": 4 / 5,
  "3x4": 3 / 4,
  "1x1": 1,
  "16x9": 16 / 9,
} satisfies Record<Aspect, number>;

/** The listed aspect a `width`×`height` frame matches within 2%, if any. */
export function aspectOf(width: number, height: number): Option.Option<Aspect> {
  if (width <= 0 || height <= 0) return Option.none();
  const ratio = width / height;

  return Array.findFirst(ASPECTS, (aspect) => Math.abs(ratio / ASPECT_RATIO[aspect] - 1) < 0.02);
}

export interface CheckOptions {
  readonly aspect?: Aspect | undefined;
  readonly format?: FormatDoc | undefined;
}

const isUploadCodec = Match.type<string | undefined>().pipe(
  Match.when("h264", () => true),
  Match.when("hevc", () => true),
  Match.orElse(() => false),
);

/** Deterministic upload checks for one short-form video, optionally against a format recipe. */
export function checkVideo(p: MediaProbe, options: CheckOptions): Check[] {
  const checks: Check[] = [
    {
      name: "codec",
      ok: isUploadCodec(p.videoCodec),
      detail: `video ${p.videoCodec ?? "none"}, audio ${p.audioCodec ?? "none"}`,
    },
  ];

  const { aspect, format } = options;

  if (aspect !== undefined) {
    checks.push({
      name: "aspect",
      ok: p.height > 0 && Math.abs(p.width / p.height - ASPECT_RATIO[aspect]) < 0.01,
      detail: `${p.width}x${p.height} for [${aspect}]`,
    });
  }

  if (aspect === "9x16") {
    checks.push({
      name: "resolution",
      ok: p.height >= 1920,
      detail: `${p.width}x${p.height}, want ≥1080x1920`,
    });
  }

  if (format?.requireAudio ?? true) {
    checks.push({
      name: "audio",
      ok: p.hasAudio,
      detail: p.hasAudio ? "audio track present" : "no audio track",
    });
  }

  if (p.hasAudio && p.videoStart !== undefined && p.audioStart !== undefined) {
    checks.push({
      name: "stream start",
      ok: Math.abs(p.videoStart - p.audioStart) < 0.05,
      detail: `video ${p.videoStart}s, audio ${p.audioStart}s`,
    });
  }

  if (format?.fps !== undefined) {
    checks.push({
      name: "fps",
      ok: Math.abs(p.fps - format.fps) < 0.5,
      detail: `${p.fps} fps, want ${format.fps}`,
    });
  }

  if (format?.duration !== undefined) {
    const { min, max } = format.duration;
    checks.push({
      name: "duration",
      ok: p.duration >= min && p.duration <= max,
      detail: `${p.duration.toFixed(2)}s, want ${min}–${max}s`,
    });
  }

  return checks;
}
