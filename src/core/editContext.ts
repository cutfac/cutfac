import { Effect, Option } from "effect";

import { editDir, itemRel } from "./editFiles.ts";
import type { Item } from "./items.ts";
import { ffmpeg, type MediaKind } from "./media.ts";
import type { EditContext, Feedback, Region } from "./schema.ts";
import { Workspace } from "./workspace.ts";

/** Clip length when the request names a single point instead of a range. */
const POINT_CLIP_SECONDS = 3;

/** The range as a clip and the frame with the region drawn on it, as the user saw them. */
export const buildContext = Effect.fnUntraced(function* (
  item: Item,
  f: Feedback,
  mediaName: string,
  kind: MediaKind,
) {
  const ws = yield* Workspace;
  const sourceAbs = yield* ws.abs(`${item.dir}/${mediaName}`);
  const dir = editDir(item, f.id);
  const warnings: string[] = [];
  yield* ws.mkdir(dir);

  /** One ffmpeg output for the agent; a failure becomes a warning instead of failing the request. */
  const attempt = (label: string, out: string, args: (outAbs: string) => ReadonlyArray<string>) =>
    Effect.flatMap(ws.abs(out), (outAbs) => ffmpeg(args(outAbs))).pipe(
      Effect.as(itemRel(item, out)),
      Effect.tapError((error) => Effect.sync(() => warnings.push(`${label}: ${error.message}`))),
      Effect.option,
      Effect.map(Option.getOrUndefined),
    );

  const start = f.timecode;

  const clip =
    kind === "video" && start !== undefined
      ? yield* attempt("clip", `${dir}/clip.mp4`, (out) => clipArgs(sourceAbs, out, start, f.end))
      : undefined;

  const frameAt = f.region?.at ?? f.timecode;

  const frame =
    kind === "image" || frameAt !== undefined
      ? yield* attempt("frame", `${dir}/frame.png`, (out) =>
          frameArgs(sourceAbs, out, kind === "video" ? frameAt : undefined, f.region),
        )
      : undefined;

  const context: EditContext = { clip, frame };

  return { context, warnings };
});

/** Frame-accurate re-encode of [start, end); a single point becomes a short clip from it. */
export function clipArgs(src: string, out: string, start: number, end?: number): string[] {
  const duration = end === undefined ? POINT_CLIP_SECONDS : end - start;

  return [
    "-ss",
    String(start),
    "-i",
    src,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    out,
  ];
}

export function frameArgs(src: string, out: string, at?: number, region?: Region): string[] {
  const seek = at === undefined ? [] : ["-ss", String(at)];
  const box = region === undefined ? [] : ["-vf", drawboxFilter(region)];

  return [...seek, "-i", src, "-frames:v", "1", ...box, out];
}

const fixed4 = (v: number) => v.toFixed(4);

/** ffmpeg drawbox in frame-relative units, so the stored region works at any resolution. */
export function drawboxFilter(r: Region): string {
  const [x, y, w, h] = [r.x, r.y, r.w, r.h].map(fixed4);

  return `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=red@0.9:t=8`;
}
