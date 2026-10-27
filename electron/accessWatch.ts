import { Effect, Option, Schedule, Schema } from "effect";

import type { Permission } from "../web/src/desktop.ts";
import type { Frame } from "./settingsWindow.ts";

const PERMISSIONS = ["screen", "accessibility"] as const satisfies ReadonlyArray<Permission>;

export const KnownPermission = Schema.Literals(PERMISSIONS);

export const isPermission = Schema.is(KnownPermission);

const POLL = "1 second";

/** Long enough to find the list and drag the app in; past that the board checks on focus. */
const WATCH_FOR = "10 minutes";

export const HELPER = {
  /** As wide as the list it points at, at the least. */
  width: 440,
  height: 72,
  /** The System Settings sidebar, which the panel leaves out to line up with the list beside it. */
  sidebar: 230,
  gap: 10,
};

export interface Area {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Where the panel goes for the System Settings window at `frame` on a screen whose work area is
 * `area`: right under it, lined up with the list beside its sidebar, as PermissionFlow places its
 * own, and kept on that screen.
 */
export function helperBounds(frame: Frame, area: Area): Area {
  const width = Math.min(
    Math.max(HELPER.width, frame.width - HELPER.sidebar),
    area.width - HELPER.gap * 2,
  );

  return {
    x: Math.round(
      clamp(
        frame.x + HELPER.sidebar,
        area.x + HELPER.gap,
        area.x + area.width - width - HELPER.gap,
      ),
    ),
    y: Math.round(
      clamp(
        frame.y + frame.height + HELPER.gap,
        area.y + HELPER.gap,
        area.y + area.height - HELPER.height - HELPER.gap,
      ),
    ),
    width: Math.round(width),
    height: HELPER.height,
  };
}

/** Checks `granted` every second until it holds, for ten minutes at most; none if it never did. */
export const awaitGrant = (granted: Effect.Effect<boolean>) =>
  Effect.repeat(granted, { schedule: Schedule.spaced(POLL), until: (ok) => ok }).pipe(
    Effect.timeoutOption(WATCH_FOR),
    Effect.map(Option.filter((ok) => ok)),
  );
