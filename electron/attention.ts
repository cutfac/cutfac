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
    asking: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        about: Schema.Literals(["approval", "question"]),
      }),
    ),
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
 * agent starts asking for an OK or an answer while the app is in the background, since it can't go
 * on until they answer.
 */
export function handleAttention(host: AttentionHost): void {
  // What each notification is about, the video and what it asks. A notification nothing holds on
  // to is collected, and a click on it goes nowhere.
  const shown = new Map<Notification, string>();
  let asking = new Set<string>();

  const notify = (key: string, title: string, about: "approval" | "question") => {
    const messages = MESSAGES[host.locale()];

    const notice = new Notification({
      title: about === "approval" ? messages.asking : messages.question,
      body: title,
    });

    shown.set(notice, key);
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
      const key = `${video.about} ${video.id}`;

      if (away && !asking.has(key)) notify(key, video.title, video.about);
      now.add(key);
    }

    // What was answered, wherever, no longer waits in Notification Center.
    for (const [notice, key] of shown) if (!now.has(key)) notice.close();

    asking = now;
  });
}
