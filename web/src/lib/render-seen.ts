import type { RenderState } from "./render.ts";

const seenKey = (item: string) => `cutfac.render.failedSeen.${item}`;

/**
 * Whether the user opened the item since its render failed, so its tile stops asking for them.
 * Kept in this browser: it is a nudge, not part of the workspace.
 */
export function failureSeen(render: RenderState): boolean {
  try {
    return localStorage.getItem(seenKey(render.item)) === String(render.startedAt);
  } catch {
    return false;
  }
}

export function seeFailure(render: RenderState): void {
  try {
    localStorage.setItem(seenKey(render.item), String(render.startedAt));
  } catch {
    // Storage can be blocked; the tile then keeps showing the failure until the next render.
  }
}
