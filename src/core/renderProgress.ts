import { Schema } from "effect";

/** How far a render is: getting ready, drawing its frames, then writing the file. */
export const RENDER_STAGES = ["preparing", "frames", "encoding"] as const;

export type RenderStage = (typeof RENDER_STAGES)[number];

/** What a render counts its progress in. */
export const RENDER_UNITS = ["frames", "seconds"] as const;

/** What a render's output said last about how far it is. */
export const RenderProgress = Schema.Struct({
  stage: Schema.Literals(RENDER_STAGES),
  /** How much of the stage is done, counted in `unit`. */
  done: Schema.optional(Schema.Finite),
  total: Schema.optional(Schema.Finite),
  unit: Schema.optional(Schema.Literals(RENDER_UNITS)),
  /** The stage's share done, from 0 to 1. */
  percent: Schema.optional(Schema.Finite),
  /** How long ffmpeg said its input runs, in seconds, to measure `time=` against. */
  duration: Schema.optional(Schema.Finite),
});

export type RenderProgress = typeof RenderProgress.Type;

export const START_PROGRESS: RenderProgress = { stage: "preparing" };

// oxlint-disable-next-line no-control-regex -- terminal color codes are what this strips
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** How much of one line a render keeps, so a minified or binary dump doesn't fill the log. */
const LINE_CHARS = 500;

/** A line of output without the color codes a terminal would have drawn, cut to a length to show. */
export const plainLine = (line: string) => line.replace(ANSI, "").trimEnd().slice(0, LINE_CHARS);

const clamp = (value: number) => Math.min(1, Math.max(0, value));

const seconds = (h: string, m: string, s: string) => Number(h) * 3600 + Number(m) * 60 + Number(s);

/** `done` of `total`, read as the stage's share done. */
const counted = (
  stage: RenderStage,
  done: number,
  total: number,
  unit: (typeof RENDER_UNITS)[number],
  duration?: number,
): RenderProgress => ({
  stage,
  done,
  total,
  unit,
  percent: total > 0 ? clamp(done / total) : undefined,
  duration,
});

/**
 * Fold one plain line of a render's output into how far it is. Reads the Remotion CLI (`Bundling code
 * 42%`, `Rendered 12/60`, `Encoded 60/60`) and ffmpeg (`Duration:`, then `time=`); any other
 * command still moves the bar when it prints a percentage.
 */
export function readProgress(progress: RenderProgress, line: string): RenderProgress {
  const { duration } = progress;

  const bundling = /^Bundl(?:ing|ed) code\b.*?(\d+(?:\.\d+)?)%/.exec(line);

  if (bundling?.[1] !== undefined) {
    return { stage: "preparing", percent: clamp(Number(bundling[1]) / 100), duration };
  }

  const frames = /\bRendered (\d+)\/(\d+)/.exec(line);

  if (frames?.[1] !== undefined && frames[2] !== undefined) {
    return counted("frames", Number(frames[1]), Number(frames[2]), "frames", duration);
  }

  const encoded = /\bEncoded (\d+)\/(\d+)/.exec(line);

  if (encoded?.[1] !== undefined && encoded[2] !== undefined) {
    return counted("encoding", Number(encoded[1]), Number(encoded[2]), "frames", duration);
  }

  // ffmpeg names each input's length before it starts; the first input sets the pace.
  const length = /^\s*Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);

  if (length?.[1] !== undefined && length[2] !== undefined && length[3] !== undefined) {
    return duration === undefined
      ? { ...progress, duration: seconds(length[1], length[2], length[3]) }
      : progress;
  }

  const time = /\btime=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(line);

  if (time?.[1] !== undefined && time[2] !== undefined && time[3] !== undefined) {
    const at = seconds(time[1], time[2], time[3]);

    return duration === undefined
      ? { stage: "encoding", done: at, unit: "seconds" }
      : counted("encoding", at, duration, "seconds", duration);
  }

  // A bar counting frames or seconds ignores stray percentages, such as libx264's closing stats.
  if (progress.total !== undefined) return progress;

  const percent = /(?:^|\s)(\d{1,3}(?:\.\d+)?)%(?:\s|$)/.exec(line);

  if (percent?.[1] !== undefined && Number(percent[1]) <= 100) {
    return { ...progress, percent: clamp(Number(percent[1]) / 100) };
  }

  return progress;
}

/** How many lines of output a render keeps to show, and to hand back when it fails. */
export const LOG_LINES = 40;

/** A line with its numbers blanked, to tell a progress line repeating itself. */
const withoutNumbers = (line: string) => line.replace(/\d+(?:\.\d+)?/g, "#");

/**
 * Add a plain line to the kept log. A line that only moves the numbers of the one before it, such as
 * `Rendered 12/60` after `Rendered 11/60`, takes its place, so progress doesn't push out the rest.
 */
export function appendLog(log: ReadonlyArray<string>, line: string): ReadonlyArray<string> {
  if (line.trim() === "") return log;

  const last = log.at(-1);

  if (last !== undefined && withoutNumbers(last) === withoutNumbers(line))
    return [...log.slice(0, -1), line];

  return [...log, line].slice(-LOG_LINES);
}
