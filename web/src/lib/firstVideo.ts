import { api } from "../api.ts";
import { href } from "../hooks.ts";
import { holdDraft } from "./newVideo.ts";

/**
 * Where the first launch ends: on a new video, so asking for it is the next thing to do; on the
 * board when the workspace already has videos.
 */
export async function openFirstVideo() {
  const items = await api.items().catch(() => undefined);

  if (items?.length === 0) openNewVideo();
  else location.hash = href("board");
}

/**
 * New video: an empty editor, where the chat asks for it. Nothing is made until the first request
 * goes out. `draft` waits in the composer for the user to look over and send.
 */
export function openNewVideo(draft?: string) {
  if (draft !== undefined) holdDraft(draft);

  location.hash = href("new");
}
