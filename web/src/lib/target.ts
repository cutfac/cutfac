import type { Feedback, Region } from "../api.ts";
import { formatTime } from "./time.ts";

/** What an edit request points at: a range (or a point) and optionally a box on one frame. */
export interface Target {
  readonly start?: number;
  readonly end?: number;
  readonly region?: Region;
}

/** A target still being assembled, before it is handed out read-only. */
type TargetDraft = { -readonly [Key in keyof Target]: Target[Key] };

export const NO_TARGET: Target = {};

/** Times are kept to a tenth of a second; finer than that is noise from dragging. */
export const roundTime = (seconds: number) => Math.round(seconds * 10) / 10;

export const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

/** `0.25` → `"25%"`, for CSS positions. */
export const percent = (fraction: number) => `${fraction * 100}%`;

export const isEmptyTarget = (target: Target) =>
  target.start === undefined && target.end === undefined && target.region === undefined;

export const hasRange = (target: Target) => target.start !== undefined;

/** `0:03.2–0:05.0 · box at 0:04.0` */
export function describeTarget(target: Target): string {
  const parts: string[] = [];

  if (target.start !== undefined) {
    parts.push(
      target.end === undefined
        ? formatTime(target.start)
        : `${formatTime(target.start)}–${formatTime(target.end)}`,
    );
  }

  if (target.region !== undefined) parts.push(`box at ${formatTime(target.region.at)}`);

  return parts.join(" · ");
}

/** A target from its parts, leaving out the ones that are not set. */
function targetFrom(
  start: number | undefined,
  end: number | undefined,
  region: Region | undefined,
) {
  const target: TargetDraft = {};

  if (start !== undefined) target.start = start;

  if (end !== undefined) target.end = end;

  if (region !== undefined) target.region = region;

  return target;
}

/** Keep the box, replace the range. A range shorter than a tenth of a second is a point. */
export function withRange(target: Target, from: number, to?: number): Target {
  const a = roundTime(Math.max(0, from));
  const b = to === undefined ? undefined : roundTime(Math.max(0, to));

  if (b === undefined || b === a) return targetFrom(a, undefined, target.region);

  return targetFrom(Math.min(a, b), Math.max(a, b), target.region);
}

/** The in point moves to `at`; an out point before it no longer makes a range. */
export function withStart(target: Target, at: number): Target {
  return target.end !== undefined && target.end > at
    ? withRange(target, at, target.end)
    : withRange(target, at);
}

/** The out point moves to `at`, starting the range at 0:00 when there is no in point yet. */
export const withEnd = (target: Target, at: number): Target =>
  withRange(target, target.start ?? 0, at);

export const withoutRange = (target: Target): Target =>
  targetFrom(undefined, undefined, target.region);

export const withRegion = (target: Target, region: Region | undefined): Target =>
  targetFrom(target.start, target.end, region);

export const withoutRegion = (target: Target): Target =>
  targetFrom(target.start, target.end, undefined);

/** Where a past request pointed. */
export const targetOf = (feedback: Feedback): Target =>
  targetFrom(feedback.timecode, feedback.end, feedback.region);

/** Where to put the playhead to look at a target: its box's frame, else its start. */
export const anchorOf = (target: Target): number | undefined => target.region?.at ?? target.start;
