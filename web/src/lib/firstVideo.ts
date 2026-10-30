import { api } from "../api.ts";
import { href } from "../hooks.ts";
import { messages } from "../i18n/index.ts";
import { holdDraft } from "./newVideo.ts";
import { sendFailed } from "./notify.ts";

/**
 * Where the first launch ends: in an empty editor for the first video, so asking for it is the
 * next thing to do; on the board when the workspace already has videos, or one can't be made.
 */
export async function openFirstVideo(title: string) {
  const items = await api.items().catch(() => undefined);

  if (items?.length === 0) await openEmptyVideo(title);
  else location.hash = href("board");
}

/** An empty editor for a new video, or the board when one can't be made. */
export async function openEmptyVideo(title: string) {
  const item = await api.createItem({ title, empty: true }).catch(() => undefined);

  location.hash = item === undefined ? href("board") : href("item", item.id);
}

let opening = false;

/**
 * New video: an empty editor, where the chat asks for it. `draft` waits in the chat's composer
 * for the user to look over and send. Says why when one can't be made, such as past the free limit.
 */
export async function openNewVideo(draft?: string) {
  // A second press while the first is on its way would make a second video.
  if (opening) return;

  opening = true;

  try {
    const item = await api.createItem({ title: messages().newItem.untitled, empty: true });

    if (draft !== undefined) holdDraft(item.id, draft);

    location.hash = href("item", item.id);
  } catch (cause) {
    sendFailed(cause);
  } finally {
    opening = false;
  }
}
