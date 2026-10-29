/** A drag shorter than this, as a fraction of the frame, was a click that wobbled. */
export const MIN_BOX = 0.02;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** What a press on a set box grabbed: its inside, which moves it, or a corner, which resizes it. */
export const HANDLES = ["move", "nw", "ne", "sw", "se"] as const;

export type Handle = (typeof HANDLES)[number];

export const isHandle = (value: string | undefined): value is Handle =>
  HANDLES.some((handle) => handle === value);

export const thousandths = (value: number) => Math.round(value * 1000) / 1000;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * The box moved, or one corner dragged, by a fraction of the frame. It stays inside the frame and
 * no smaller than MIN_BOX.
 */
export function editBox(box: Box, handle: Handle, dx: number, dy: number): Box {
  if (handle === "move") {
    return {
      ...box,
      x: thousandths(clamp(box.x + dx, 0, 1 - box.w)),
      y: thousandths(clamp(box.y + dy, 0, 1 - box.h)),
    };
  }

  const right = box.x + box.w;
  const bottom = box.y + box.h;
  const left = handle.endsWith("w") ? clamp(box.x + dx, 0, right - MIN_BOX) : box.x;
  const top = handle.startsWith("n") ? clamp(box.y + dy, 0, bottom - MIN_BOX) : box.y;
  const newRight = handle.endsWith("e") ? clamp(right + dx, box.x + MIN_BOX, 1) : right;
  const newBottom = handle.startsWith("s") ? clamp(bottom + dy, box.y + MIN_BOX, 1) : bottom;

  return {
    x: thousandths(left),
    y: thousandths(top),
    w: thousandths(newRight - left),
    h: thousandths(newBottom - top),
  };
}

export const boxBetween = (from: Point, to: Point): Box => ({
  x: thousandths(Math.min(from.x, to.x)),
  y: thousandths(Math.min(from.y, to.y)),
  w: thousandths(Math.abs(to.x - from.x)),
  h: thousandths(Math.abs(to.y - from.y)),
});
