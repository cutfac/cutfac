import type { RenderState } from "./render.ts";
import { readStored } from "./storage.ts";

const seenKey = (item: string) => `cutfac.render.failedSeen.${item}`;

/**
 * Whether the user opened the item since its render failed, so its tile stops asking for them.
 * Kept in this browser: it is a nudge, not part of the workspace.
 */
export const failureSeen = (render: RenderState) =>
  readStored(seenKey(render.item)) === String(render.startedAt);

export function seeFailure(render: RenderState): void {
  try {
    localStorage.setItem(seenKey(render.item), String(render.startedAt));
  } catch {
    // Storage can be blocked; the tile then keeps showing the failure until the next render.
  }
}
