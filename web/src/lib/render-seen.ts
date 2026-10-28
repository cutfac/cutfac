import type { RenderState } from "./render.ts";
import { readStored, writeStored } from "./storage.ts";

const seenKey = (item: string) => `cutfac.render.failedSeen.${item}`;

/**
 * Whether the user opened the item since its render failed, so its tile stops asking for them.
 * Kept in this browser: it is a nudge, not part of the workspace.
 */
export const failureSeen = (render: RenderState) =>
  readStored(seenKey(render.item)) === String(render.startedAt);

export function seeFailure(render: RenderState): void {
  writeStored(seenKey(render.item), String(render.startedAt));
}
