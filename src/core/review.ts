import { Effect } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { type Item, getItem } from "./items.ts";
import { aspectOf, ffmpeg, probe, sceneCuts } from "./media.ts";
import { ReviewDoc, type ReviewShot, type SafeZone } from "./schema.ts";
import { Workspace, foldersWith, nowIso } from "./workspace.ts";

/** Item subfolder with one review folder per video, named after the video. */
const REVIEW_DIR = "review";

/** Frames on the sheet when the caller names no times. */
export const DEFAULT_FRAMES = 12;

/** Past this many frames the tiles get too small to read. */
export const MAX_FRAMES = 24;

/** Strips per review; the rest of the cuts are left out with a note. */
export const MAX_STRIPS = 8;

export const SHEET_FILE = "sheet.jpg";

const REVIEW_FILE = "review.yaml";

/** A strip covers this many seconds on each side of its transition, at STRIP_FPS: six frames. */
const STRIP_REACH = 0.25;

const STRIP_FPS = 12;

const STRIP_FRAMES = Math.round(2 * STRIP_REACH * STRIP_FPS);

export interface ReviewOptions {
  /** Seconds to put on the sheet; none means DEFAULT_FRAMES from the first frame to the last. */
  readonly times?: ReadonlyArray<number> | undefined;
  /** Seconds to show the motion around; defaults to the detected cuts. */
  readonly transitions?: ReadonlyArray<number> | undefined;
  /** Shade the bands platform UI covers, on video that has them; on unless false. */
  readonly safeZones?: boolean | undefined;
}

/**
 * Where Reels, Shorts, and TikTok lay their captions, buttons, and progress bar over full-screen
 * vertical video, as fractions of its height. Wider frames show in a feed with nothing on top.
 */
export const VERTICAL_SAFE_ZONE: SafeZone = { top: 0.12, bottom: 0.2 };

/** The bands platform UI covers on a `width`×`height` video, if it has any. */
export const safeZoneOf = (width: number, height: number): SafeZone | undefined =>
  aspectOf(width, height) === "9x16" ? VERTICAL_SAFE_ZONE : undefined;

const band = (y: string, h: string) => `drawbox=x=0:y=${y}:w=iw:h=${h}:color=black@0.45:t=fill`;

const edge = (y: string) => `drawbox=x=0:y=${y}:w=iw:h=2:color=yellow@0.9:t=fill`;

/**
 * ffmpeg filters that dim the bands and line their inner edges, so text or a subject inside them
 * stands out without being hidden. Run after scaling, so the lines stay two pixels thick.
 */
export function safeZoneFilters(zone: SafeZone): string[] {
  const bottom = 1 - zone.bottom;

  return [
    band("0", `ih*${zone.top}`),
    band(`ih*${bottom}`, `ih*${zone.bottom}`),
    edge(`ih*${zone.top}`),
    edge(`ih*${bottom}-2`),
  ];
}

export interface MediaReview extends ReviewDoc {
  /** Workspace-relative folder; the doc's files are relative to it. */
  readonly dir: string;
}

/** Down to the hundredth, so the last sampled time never lands past the last frame. */
const floor2 = (t: number) => Math.floor(t * 100) / 100;

const shotFile = (folder: string, t: number) => `${folder}/t${t.toFixed(2).padStart(6, "0")}.jpg`;

/** Time of the last frame, the latest a frame can be taken from. */
const lastFrame = (duration: number, fps: number) =>
  floor2(Math.max(0, duration - (fps > 0 ? 1 / fps : 0.04)));

/** `count` times spread evenly from the first frame to the last, so both the hook and the end show. */
export function sampleTimes(duration: number, fps: number, count = DEFAULT_FRAMES): number[] {
  const last = lastFrame(duration, fps);
  const steps = Math.max(1, count - 1);
  const times = Array.from({ length: count }, (_, i) => floor2((last * i) / steps));

  return [...new Set(times)];
}

/** Sorted, unique, and within the video; a time past the last frame moves onto it. */
const checkTimes = (
  label: string,
  times: ReadonlyArray<number>,
  limits: { readonly duration: number; readonly last: number; readonly max: number },
) => {
  const outside = times.find((t) => !(t >= 0 && t <= limits.duration));

  if (outside !== undefined) {
    return Effect.fail(
      new InvalidRequest({
        message: `${label} ${outside}s is outside the video, which runs 0–${limits.duration}s`,
      }),
    );
  }

  if (times.length > limits.max) {
    return Effect.fail(
      new InvalidRequest({ message: `At most ${limits.max} ${label}s per review` }),
    );
  }

  const clamped = times.map((t) => floor2(Math.min(t, limits.last)));

  return Effect.succeed([...new Set(clamped)].toSorted((a, b) => a - b));
};

/** Tiles per sheet row and tile width: phone-shaped frames sit six to a row, wider ones four. */
const sheetLayout = (portrait: boolean) =>
  portrait ? { columns: 6, width: 240 } : { columns: 4, width: 360 };

/** Join the frame files into one image; the concat filter avoids globbing names like `[9x16]`. */
export function sheetArgs(abs: string, frames: ReadonlyArray<ReviewShot>, portrait: boolean) {
  const layout = sheetLayout(portrait);
  const columns = Math.min(frames.length, layout.columns);
  const rows = Math.ceil(frames.length / columns);

  return [
    ...frames.flatMap((frame) => ["-i", `${abs}/${frame.file}`]),
    "-filter_complex",
    `concat=n=${frames.length}:v=1:a=0,scale=${layout.width}:-2,` +
      `tile=${columns}x${rows}:padding=4:margin=4:color=white`,
    "-frames:v",
    "1",
    "-q:v",
    "3",
    `${abs}/${SHEET_FILE}`,
  ];
}

/**
 * Render what a viewer would see, for the agent to judge before it hands the video off: frames
 * from the first to the last, a contact sheet of them, and a strip of frames across each cut.
 * Writes `review/<video name>/` in the item, with a `review.yaml` the board reads, replacing the
 * last review of that video.
 */
export const reviewMedia = Effect.fn("review.reviewMedia")(function* (
  id: string,
  file: string,
  options: ReviewOptions = {},
) {
  const ws = yield* Workspace;
  const item = yield* getItem(id);
  const media = item.media.find((m) => m.name === file);

  if (media === undefined)
    return yield* new NotFound({ message: `No media named ${file} on ${id}` });

  if (media.kind !== "video")
    return yield* new InvalidRequest({ message: `${file} is not a video` });

  const input = yield* ws.abs(`${item.dir}/${file}`);
  const info = yield* probe(input);
  const limits = { duration: info.duration, last: lastFrame(info.duration, info.fps) };
  const notes: string[] = [];

  /** Make one output, resolving to `[made]`; a failure becomes a note and `[]`. */
  const attempt = <A>(label: string, args: ReadonlyArray<string>, made: A) =>
    ffmpeg(args).pipe(
      Effect.as([made]),
      Effect.catchTag("CommandFailed", (error) =>
        Effect.sync((): A[] => {
          notes.push(`${label}: ${error.message}`);

          return [];
        }),
      ),
    );

  const times =
    options.times === undefined || options.times.length === 0
      ? sampleTimes(info.duration, info.fps)
      : yield* checkTimes("time", options.times, { ...limits, max: MAX_FRAMES });

  const transitions =
    options.transitions === undefined
      ? yield* detectedCuts(input, notes)
      : yield* checkTimes("transition", options.transitions, { ...limits, max: MAX_STRIPS });

  const dir = `${item.dir}/${REVIEW_DIR}/${file.replace(/\.[^.]+$/, "")}`;
  const abs = yield* ws.abs(dir);
  yield* ws.remove(dir);
  yield* ws.mkdir(`${dir}/frames`);
  yield* ws.mkdir(`${dir}/strips`);

  const portrait = info.height > info.width;
  const safeZone = options.safeZones === false ? undefined : safeZoneOf(info.width, info.height);

  /** Scale to `width`, then shade the safe zone when there is one. */
  const fit = (width: number) =>
    [`scale=${width}:-2`, ...(safeZone === undefined ? [] : safeZoneFilters(safeZone))].join(",");

  const frames = yield* Effect.forEach(
    times,
    (t) => {
      const shot: ReviewShot = { t, file: shotFile("frames", t) };

      return attempt(
        `frame at ${t}s`,
        [
          "-ss",
          String(t),
          "-i",
          input,
          "-frames:v",
          "1",
          "-vf",
          fit(portrait ? 540 : 960),
          "-q:v",
          "3",
          `${abs}/${shot.file}`,
        ],
        shot,
      );
    },
    { concurrency: 4 },
  );

  const strips = yield* Effect.forEach(
    transitions,
    (t) => {
      const shot: ReviewShot = { t, file: shotFile("strips", t) };

      return attempt(
        `strip at ${t}s`,
        [
          "-ss",
          Math.max(0, t - STRIP_REACH).toFixed(2),
          "-t",
          String(2 * STRIP_REACH),
          "-i",
          input,
          "-vf",
          `fps=${STRIP_FPS},${fit(portrait ? 200 : 320)},` +
            `tile=${STRIP_FRAMES}x1:padding=2:margin=2`,
          "-frames:v",
          "1",
          "-q:v",
          "3",
          `${abs}/${shot.file}`,
        ],
        shot,
      );
    },
    { concurrency: 4 },
  );

  const made = frames.flat();

  const [sheet] =
    made.length === 0 ? [] : yield* attempt("sheet", sheetArgs(abs, made, portrait), SHEET_FILE);

  const doc: ReviewDoc = {
    file,
    at: yield* nowIso,
    sheet,
    frames: made,
    strips: strips.flat(),
    safeZone,
    notes,
  };

  yield* ws.writeYaml(`${dir}/${REVIEW_FILE}`, ReviewDoc, doc);

  return { dir, ...doc } satisfies MediaReview;
});

const percent = (fraction: number) => `${Math.round(fraction * 100)}%`;

/**
 * What to check on a review's frames, for the agent that made it. Each point asks what a viewer
 * with the sound off sees, since a frame can match the code that drew it and still fail them.
 */
export function reviewChecklist(review: ReviewDoc): string[] {
  const { safeZone } = review;

  return [
    "For each frame, say what it is meant to show, then check that a viewer with the sound off sees it: nothing covers it (a band, a box, another layer), it reads at phone size, and nothing important is cut off at the edges.",
    ...(safeZone === undefined
      ? []
      : [
          `The dimmed bands, the top ${percent(safeZone.top)} and bottom ${percent(safeZone.bottom)} between the yellow lines, are where platform captions and buttons cover the video. Text, a face, or the thing a frame is about inside them is a defect, even when it looks fine here.`,
        ]),
    "In each strip, check that motion lands cleanly and that nothing shows for only a frame or two. A line of text has to stay up long enough to read twice; sample its first and last frames with `times` when unsure.",
    "Never call a frame clean without naming what it shows. Report the three largest defects with their times, or say why there are none.",
  ];
}

/** The last review of each of the item's videos that is still there; unreadable ones are skipped. */
export const listReviews = Effect.fn("review.listReviews")(function* (item: Item) {
  const ws = yield* Workspace;
  const root = `${item.dir}/${REVIEW_DIR}`;
  const folders = yield* foldersWith(root, REVIEW_FILE);

  const reviews = yield* Effect.forEach(
    folders,
    (name) => {
      const dir = `${root}/${name}`;

      return ws.readYaml(`${dir}/${REVIEW_FILE}`, ReviewDoc).pipe(
        Effect.map((doc): MediaReview[] => [{ dir, ...doc }]),
        Effect.orElseSucceed((): MediaReview[] => []),
      );
    },
    { concurrency: 4 },
  );

  return reviews.flat().filter((review) => item.media.some((m) => m.name === review.file));
});

/** The cuts ffmpeg finds, up to MAX_STRIPS; anything left out or failed is noted. */
const detectedCuts = Effect.fnUntraced(function* (input: string, notes: string[]) {
  const cuts = yield* sceneCuts(input).pipe(
    Effect.catchTag("CommandFailed", (error) =>
      Effect.sync((): number[] => {
        notes.push(error.message);

        return [];
      }),
    ),
  );

  if (cuts.length === 0) {
    notes.push("No cuts detected. Pass transitions to see the motion at chosen times.");
  }

  if (cuts.length > MAX_STRIPS) {
    notes.push(
      `Showing strips for the first ${MAX_STRIPS} of ${cuts.length} cuts. Pass transitions to see others.`,
    );
  }

  return cuts.slice(0, MAX_STRIPS);
});
