import { anchorOf, type Target } from "./target.ts";

/** Where one video plays side by side, in its own seconds. */
export interface PlayWindow {
  readonly start: number;
  readonly end: number;
}

/**
 * Where each video side by side plays: all from the same start, each to the end of its own take
 * on the part the request pointed at. A take of a different length moved what comes after the
 * part by that much, so a part ends that much later or sooner in it than in the `original`.
 * Without a part, each plays from where the edit shows to its own end.
 */
export function playWindows(
  target: Target,
  durations: ReadonlyArray<number>,
  original: number | undefined,
): ReadonlyArray<PlayWindow> {
  const { start, end } = target;
  const from = start ?? anchorOf(target) ?? 0;
  const base = original === undefined ? undefined : durations[original];

  return durations.map((duration) => {
    const shift = base === undefined ? 0 : duration - base;
    const until = start === undefined || end === undefined ? duration : end + shift;
    const begin = Math.min(from, duration);

    return { start: begin, end: Math.min(Math.max(until, begin), duration) };
  });
}
