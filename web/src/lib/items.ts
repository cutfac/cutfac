import { toast } from "sonner";

import { api, type ItemSummary, type Status } from "../api.ts";
import { desktop } from "../desktop.ts";
import type { Live } from "../hooks.ts";
import type { Messages } from "../i18n/index.ts";
import { sendFailed } from "./notify.ts";

/** Move a video to another column of the board. Resolves whether it moved. */
export const moveItem = (id: string, status: Status) =>
  api.updateItem(id, { status }).then(
    () => true,
    (cause: unknown) => {
      sendFailed(cause);

      return false;
    },
  );

/**
 * Move videos to another column at once; the list loads again from the files if one fails. Those
 * already there stay put.
 */
export function moveItems(
  live: Pick<Live<ReadonlyArray<ItemSummary>>, "data" | "setData" | "reload">,
  moving: readonly ItemSummary[],
  status: Status,
) {
  const ids = new Set(moving.flatMap((i) => (i.status === status ? [] : [i.id])));

  if (live.data === undefined || ids.size === 0) return;

  live.setData(live.data.map((i) => (ids.has(i.id) ? { ...i, status, updatedAt: Date.now() } : i)));
  void Promise.all([...ids].map((id) => moveItem(id, status))).then((moved) => {
    if (moved.includes(false)) live.reload();
  });
}

/** Archive videos, with a toast that puts them back where they were. */
export const archiveItems = (items: readonly ItemSummary[], t: Messages) =>
  Promise.all(items.map((item) => api.updateItem(item.id, { status: "archived" }))).then(
    () =>
      void toast.success(t.itemActions.archived(items.map((item) => item.title)), {
        action: {
          label: t.itemActions.undo,
          onClick: () => void Promise.all(items.map((item) => moveItem(item.id, item.status))),
        },
      }),
    sendFailed,
  );

/** Show a video's folder in Finder or Explorer; the desktop app only. */
export const revealItem = (item: ItemSummary) =>
  api
    .workspace()
    .then((ws) => desktop?.revealPath(`${ws.root}/${item.dir}`))
    .catch(sendFailed);
