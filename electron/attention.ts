import { Schema } from "effect";
import {
  app,
  BrowserWindow,
  ipcMain,
  Notification,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import type { AppCommand } from "../web/src/desktop.ts";
import type { Locale } from "../web/src/i18n/locale.ts";
import { ATTENTION_CHANNEL } from "./ipc.ts";
import { MESSAGES } from "./messages.ts";

const isAttention = Schema.is(
  Schema.Struct({
    waiting: Schema.Finite,
    asking: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  }),
);

export interface AttentionHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  bringToFront: () => void;
  sendAppCommand: (command: AppCommand) => void;
  locale: () => Locale;
}

/**
 * Keeps the Dock's badge on how many videos wait for the user, and puts up a notification when an
 * agent starts asking while the app is in the background, since it can't go on until they answer.
 */
export function handleAttention(host: AttentionHost): void {
  // The video each notification is about. A notification nothing holds on to is collected, and a
  // click on it goes nowhere.
  const shown = new Map<Notification, string>();
  let asking = new Set<string>();

  const notify = (id: string, title: string) => {
    const notice = new Notification({ title: MESSAGES[host.locale()].asking, body: title });

    shown.set(notice, id);
    notice.on("close", () => shown.delete(notice));
    notice.on("click", () => {
      shown.delete(notice);
      host.bringToFront();
      // The gallery puts the videos whose agent asks first.
      host.sendAppCommand("board");
    });
    notice.show();
  };

  ipcMain.on(ATTENTION_CHANNEL, (event, next) => {
    if (!host.isFromApp(event) || !isAttention(next)) return;

    app.setBadgeCount(next.waiting);

    const away = BrowserWindow.getFocusedWindow() === null && Notification.isSupported();
    const now = new Set<string>();

    for (const video of next.asking) {
      if (away && !asking.has(video.id)) notify(video.id, video.title);
      now.add(video.id);
    }

    // What was answered, wherever, no longer waits in Notification Center.
    for (const [notice, id] of shown) if (!now.has(id)) notice.close();

    asking = now;
  });
}
