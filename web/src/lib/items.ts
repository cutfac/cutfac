import { toast } from "sonner";

import { api, type ItemSummary, type Status } from "../api.ts";
import { desktop } from "../desktop.ts";
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
