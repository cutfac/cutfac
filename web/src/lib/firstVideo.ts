import { api } from "../api.ts";
import { href } from "../hooks.ts";

/**
 * Where the first launch ends: in an empty editor for the first video, so asking for it is the
 * next thing to do; on the board when the workspace already has videos, or one can't be made.
 */
export async function openFirstVideo(title: string) {
  const item = await api
    .items()
    .then((items) => (items.length === 0 ? api.createItem({ title, empty: true }) : undefined))
    .catch(() => undefined);

  location.hash = item === undefined ? href("board") : href("item", item.id);
}
