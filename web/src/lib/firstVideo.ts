import { api } from "../api.ts";
import { href } from "../hooks.ts";

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
