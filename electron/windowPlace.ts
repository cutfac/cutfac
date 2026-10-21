import { Schema } from "effect";

/** A rectangle on the desktop, in screen points. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Size = Pick<Rect, "width" | "height">;

/** Where the window was, at its normal size even when maximized or full screen. */
export const WindowPlace = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  maximized: Schema.Boolean,
});

export type WindowPlace = typeof WindowPlace.Type;

export const decodeWindowPlace = Schema.decodeUnknownOption(WindowPlace);

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

const fit = (saved: Size, screen: Size | undefined): Size => ({
  width: Math.round(Math.min(saved.width, screen?.width ?? saved.width)),
  height: Math.round(Math.min(saved.height, screen?.height ?? saved.height)),
});

/**
 * Where the window opens again: on the screen it mostly sat on, made to fit inside it. A window on
 * none of today's screens keeps its size, up to the first screen's, and the system places it.
 */
export function placeWindow(saved: Rect, screens: readonly Rect[]): Size & Partial<Rect> {
  const screen = screens.toSorted((a, b) => overlap(saved, b) - overlap(saved, a))[0];

  if (screen === undefined || overlap(saved, screen) === 0) return fit(saved, screens[0]);

  const { width, height } = fit(saved, screen);

  return {
    x: Math.round(clamp(saved.x, screen.x, screen.x + screen.width - width)),
    y: Math.round(clamp(saved.y, screen.y, screen.y + screen.height - height)),
    width,
    height,
  };
}
