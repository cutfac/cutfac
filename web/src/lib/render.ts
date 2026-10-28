import { Option, Schema } from "effect";

import {
  RENDER_STAGES,
  RenderProgress,
  type RenderStage,
} from "../../../src/core/renderProgress.ts";
import { toolKind, type RunStep } from "./run.ts";

export { RENDER_STAGES, type RenderStage };

/** A render the agent runs through Cutfac, as the server streams it; see `src/core/render.ts`. */
export const RenderState = Schema.Struct({
  item: Schema.String,
  command: Schema.String,
  cwd: Schema.String,
  /** The media file it writes, workspace-relative, when the agent said. */
  output: Schema.optionalKey(Schema.String),
  /** Which version it makes, such as `v2`, when it is one of several. */
  label: Schema.optionalKey(Schema.String),
  status: Schema.Literals(["running", "done", "failed", "stopped"]),
  progress: RenderProgress,
  /** Epoch milliseconds. */
  startedAt: Schema.Finite,
  endedAt: Schema.optionalKey(Schema.Finite),
  code: Schema.optionalKey(Schema.Finite),
  log: Schema.Array(Schema.String),
});

export type RenderState = typeof RenderState.Type;

/** Each stage's share of the whole render; drawing the frames is most of it. */
const WEIGHTS: Record<RenderStage, number> = { preparing: 0.1, frames: 0.7, encoding: 0.2 };

/** Below this share done, a guess at the time left swings too much to show. */
const ETA_FROM = 0.05;

/**
 * The whole render's share done, from 0 to 1, or none while it can't tell. An ffmpeg command only
 * encodes, so its `time=` is the whole of it.
 */
export function renderShare(render: RenderState): Option.Option<number> {
  const { stage, percent, unit } = render.progress;

  if (render.status === "done") return Option.some(1);

  if (percent === undefined) return Option.none();

  if (unit === "seconds") return Option.some(percent);

  const before = RENDER_STAGES.slice(0, RENDER_STAGES.indexOf(stage)).reduce(
    (sum, earlier) => sum + WEIGHTS[earlier],
    0,
  );

  return Option.some(before + WEIGHTS[stage] * percent);
}

/** Milliseconds left at the pace so far, once it has gone far enough to guess. */
export const timeLeft = (elapsed: number, share: Option.Option<number>) =>
  Option.map(
    Option.filter(share, (done) => done >= ETA_FROM && done < 1),
    (done) => (elapsed * (1 - done)) / done,
  );

/** `1:32`, or `1:02:03` past an hour. */
export function spanTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const seconds = String(total % 60).padStart(2, "0");
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}`
    : `${minutes}:${seconds}`;
}

const RENDER_COMMAND = /\bremotion\s+render\b|\bffmpeg\b/;

/** An ffmpeg call that only checks it is there or grabs one frame: over before it shows. */
const QUICK_COMMAND =
  /\bffmpeg\s+-version\b|\b(?:which|command\s+-v)\s+ffmpeg\b|-frames:v\s+1\b|-vframes\s+1\b/;

/**
 * A render the agent is running in its own shell instead of through Cutfac, so the board can
 * still say it is rendering: the command the agent is waiting on, if it renders.
 */
export function shellRender(
  steps: ReadonlyArray<RunStep>,
  running: boolean,
): Option.Option<string> {
  if (!running) return Option.none();

  const last = steps.at(-1);

  if (last?.kind !== "tool" || toolKind(last.name) !== "command") return Option.none();

  return Option.filter(
    Option.fromUndefinedOr(last.detail),
    (command) => RENDER_COMMAND.test(command) && !QUICK_COMMAND.test(command),
  );
}

/** The file a render wrote, by name in the item's folder, when it is there. */
export function renderedName(render: RenderState, dir: string): Option.Option<string> {
  const prefix = `${dir}/`;

  return Option.fromUndefinedOr(render.output).pipe(
    Option.map((output) => (output.startsWith(prefix) ? output.slice(prefix.length) : output)),
    Option.filter((name) => !name.includes("/")),
  );
}
