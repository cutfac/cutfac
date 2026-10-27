import { Option, Schema } from "effect";

import { eventData, openEvents, q, send } from "./api.ts";
import { RenderState } from "./lib/render.ts";

const decodeRender = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.NullOr(RenderState)));

/** The item's latest render as it goes, `undefined` until it has one. */
export function onItemRender(id: string, listener: (render: RenderState | undefined) => void) {
  const source = openEvents(`/api/item/render${q(id)}`);

  source.addEventListener("render", (e) => {
    const render = decodeRender(eventData(e));

    if (Option.isSome(render)) listener(render.value ?? undefined);
  });

  return () => source.close();
}

/** Ask the agent's server to stop the item's render. */
export const stopRender = (id: string) =>
  send<RenderState | null, {}>("POST", `/api/item/render/stop${q(id)}`, {});
