import type { Permission } from "../desktop.ts";

export const PERMISSIONS: ReadonlyArray<Permission> = ["screen", "accessibility"];

export type Granted = Partial<Record<Permission, true>>;

export interface AccessProgress {
  /** The one whose list in System Settings the user was sent to and hasn't turned on yet. */
  waiting: Permission | undefined;
  /** The next one to turn on. */
  next: Permission | undefined;
  allGranted: boolean;
}

export function accessProgress(granted: Granted, opened: Permission | undefined): AccessProgress {
  const next = PERMISSIONS.find((permission) => !granted[permission]);

  return {
    waiting: opened !== undefined && !granted[opened] ? opened : undefined,
    next,
    allGranted: next === undefined,
  };
}

/** macOS reads screen recording once per process, so the app finds it on only after it reopens. */
export const showsAfterReopen = (permission: Permission) => permission === "screen";
