import { toast } from "sonner";

import { api, type ItemSummary, type Status } from "../api.ts";
import { desktop } from "../desktop.ts";
import type { Messages } from "../i18n/index.ts";
import { sendFailed } from "./notify.ts";

/** Move a video to another column of the board. */
export const moveItem = (id: string, status: Status) =>
  api.updateItem(id, { status }).then(() => undefined, sendFailed);

/** Archive a video, with a toast that puts it back where it was. */
export const archiveItem = (item: ItemSummary, t: Messages) =>
  api.updateItem(item.id, { status: "archived" }).then(
    () =>
      void toast.success(t.itemActions.archived(item.title), {
        action: { label: t.itemActions.undo, onClick: () => void moveItem(item.id, item.status) },
      }),
    sendFailed,
  );

/** Show a video's folder in Finder or Explorer; the desktop app only. */
export const revealItem = (item: ItemSummary) =>
  api
    .workspace()
    .then((ws) => desktop?.revealPath(`${ws.root}/${item.dir}`))
    .catch(sendFailed);
