import { eventData, openEvents, q, send } from "./api.ts";
import type { RenderState } from "./lib/render.ts";

/** The item's latest render as it goes, `undefined` until it has one. */
export function onItemRender(id: string, listener: (render: RenderState | undefined) => void) {
  const source = openEvents(`/api/item/render${q(id)}`);

  source.addEventListener("render", (e) => {
    // SAFETY: the server writes each `render` event as one JSON-encoded RenderState, or null.
    const render = JSON.parse(eventData(e)) as RenderState | null;

    listener(render ?? undefined);
  });

  return () => source.close();
}

/** Ask the agent's server to stop the item's render. */
export const stopRender = (id: string) =>
  send<RenderState | null, {}>("POST", `/api/item/render/stop${q(id)}`, {});
