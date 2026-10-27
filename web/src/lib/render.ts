import { Schema } from "effect";

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
 * The whole render's share done, from 0 to 1, or `undefined` while it can't tell. An ffmpeg
 * command only encodes, so its `time=` is the whole of it.
 */
export function renderShare(render: RenderState): number | undefined {
  const { stage, percent, unit } = render.progress;

  if (render.status === "done") return 1;

  if (percent === undefined) return undefined;

  if (unit === "seconds") return percent;

  const before = RENDER_STAGES.slice(0, RENDER_STAGES.indexOf(stage)).reduce(
    (sum, earlier) => sum + WEIGHTS[earlier],
    0,
  );

  return before + WEIGHTS[stage] * percent;
}

/** Milliseconds left at the pace so far, once it has gone far enough to guess. */
export function timeLeft(elapsed: number, share: number | undefined): number | undefined {
  if (share === undefined || share < ETA_FROM || share >= 1) return undefined;

  return (elapsed * (1 - share)) / share;
}

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
export function shellRender(steps: ReadonlyArray<RunStep>, running: boolean): string | undefined {
  if (!running) return undefined;

  const last = steps.at(-1);

  if (last?.kind !== "tool" || toolKind(last.name) !== "command") return undefined;

  const command = last.detail;

  if (command === undefined || !RENDER_COMMAND.test(command) || QUICK_COMMAND.test(command)) {
    return undefined;
  }

  return command;
}

/** The file a render wrote, by name in the item's folder, when it is there. */
export function renderedName(render: RenderState, dir: string): string | undefined {
  const { output } = render;

  if (output === undefined) return undefined;

  const prefix = `${dir}/`;
  const name = output.startsWith(prefix) ? output.slice(prefix.length) : output;

  return name.includes("/") ? undefined : name;
}
