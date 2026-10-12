import type { Aspect, FormatDoc } from "./schema.ts";
import { ASPECTS } from "./schema.ts";

const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v"]);
const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

export type MediaKind = "video" | "image";

export interface MediaFile {
  name: string;
  kind: MediaKind;
  aspect?: Aspect;
  size: number;
  mtime: number;
}

export function mediaKind(name: string): MediaKind | undefined {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  return undefined;
}

/** `[9x16] cover.jpg` → `9x16`. */
export function aspectFromName(name: string): Aspect | undefined {
  const match = /^\[(\d+x\d+)\]/.exec(name);
  const value = match?.[1];
  return ASPECTS.find((a) => a === value);
}

export function toMediaFiles(
  entries: { name: string; dir: boolean; size: number; mtime: number }[],
): MediaFile[] {
  const out: MediaFile[] = [];
  for (const e of entries) {
    if (e.dir) continue;
    const kind = mediaKind(e.name);
    if (!kind) continue;
    const aspect = aspectFromName(e.name);
    out.push({ name: e.name, kind, size: e.size, mtime: e.mtime, ...(aspect ? { aspect } : {}) });
  }
  return out;
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec?: string;
  audioCodec?: string;
  videoStart?: number;
  audioStart?: number;
}

export async function probe(absPath: string): Promise<Probe> {
  const proc = Bun.spawn(
    ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", absPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffprobe failed: ${err.trim()}`);
  return parseProbe(JSON.parse(out));
}

interface FfprobeJson {
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    start_time?: string;
  }[];
  format?: { duration?: string };
}

export function parseProbe(json: FfprobeJson): Probe {
  const streams = json.streams ?? [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  const result: Probe = {
    duration: Number(json.format?.duration ?? 0),
    width: video?.width ?? 0,
    height: video?.height ?? 0,
    fps: parseRate(video?.avg_frame_rate ?? video?.r_frame_rate),
    hasAudio: Boolean(audio),
  };
  if (video?.codec_name) result.videoCodec = video.codec_name;
  if (audio?.codec_name) result.audioCodec = audio.codec_name;
  if (video?.start_time !== undefined) result.videoStart = Number(video.start_time);
  if (audio?.start_time !== undefined) result.audioStart = Number(audio.start_time);
  return result;
}

function parseRate(rate: string | undefined): number {
  if (!rate) return 0;
  const [n, d] = rate.split("/").map(Number);
  if (!n || !d) return 0;
  return Math.round((n / d) * 100) / 100;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const ASPECT_RATIO: Record<Aspect, number> = {
  "9x16": 9 / 16,
  "4x5": 4 / 5,
  "3x4": 3 / 4,
  "1x1": 1,
  "16x9": 16 / 9,
};

/** Deterministic upload checks for one short-form video, optionally against a format recipe. */
export function checkVideo(p: Probe, opts: { aspect?: Aspect; format?: FormatDoc }): Check[] {
  const checks: Check[] = [];
  checks.push({
    name: "codec",
    ok: p.videoCodec === "h264" || p.videoCodec === "hevc",
    detail: `video ${p.videoCodec ?? "none"}, audio ${p.audioCodec ?? "none"}`,
  });
  if (opts.aspect) {
    const actual = p.width / p.height;
    checks.push({
      name: "aspect",
      ok: Math.abs(actual - ASPECT_RATIO[opts.aspect]) < 0.01,
      detail: `${p.width}x${p.height} for [${opts.aspect}]`,
    });
  }
  if (opts.aspect === "9x16") {
    checks.push({
      name: "resolution",
      ok: p.height >= 1920,
      detail: `${p.width}x${p.height}, want ≥1080x1920`,
    });
  }
  const requireAudio = opts.format?.requireAudio ?? true;
  if (requireAudio) {
    checks.push({
      name: "audio",
      ok: p.hasAudio,
      detail: p.hasAudio ? "audio track present" : "no audio track",
    });
  }
  if (p.hasAudio && p.videoStart !== undefined && p.audioStart !== undefined) {
    const drift = Math.abs(p.videoStart - p.audioStart);
    checks.push({
      name: "stream start",
      ok: drift < 0.05,
      detail: `video ${p.videoStart}s, audio ${p.audioStart}s`,
    });
  }
  if (opts.format?.fps) {
    checks.push({
      name: "fps",
      ok: Math.abs(p.fps - opts.format.fps) < 0.5,
      detail: `${p.fps} fps, want ${opts.format.fps}`,
    });
  }
  const d = opts.format?.duration;
  if (d) {
    checks.push({
      name: "duration",
      ok: p.duration >= d.min && p.duration <= d.max,
      detail: `${p.duration.toFixed(2)}s, want ${d.min}–${d.max}s`,
    });
  }
  return checks;
}
