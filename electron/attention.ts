import { Effect, Option, Ref, Schema } from "effect";
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
import { askingChanges, askingKey, type Asking } from "./asking.ts";
import { ATTENTION_CHANNEL } from "./ipc.ts";
import { MESSAGES } from "./messages.ts";
import { busyWork } from "./quitQuestion.ts";

const decodeAttention = Schema.decodeUnknownOption(
  Schema.Struct({
    waiting: Schema.Finite,
    busy: Schema.Finite,
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
  // What each notification is about. A notification nothing holds on to is collected, and a click
  // on it goes nowhere.
  const shown = Ref.makeUnsafe<ReadonlyMap<Notification, string>>(new Map());
  const asking = Ref.makeUnsafe<ReadonlySet<string>>(new Set());

  const forget = (notice: Notification) =>
    Ref.update(shown, (all) => new Map([...all].filter(([one]) => one !== notice)));

  const notify = (ask: Asking) =>
    Effect.gen(function* () {
      const runSync = Effect.runSyncWith(yield* Effect.context<never>());
      const messages = MESSAGES[host.locale()];

      const notice = new Notification({
        title: ask.about === "approval" ? messages.asking : messages.question,
        body: ask.title,
      });

      yield* Ref.update(shown, (all) => new Map([...all, [notice, askingKey(ask)]]));

      notice.on("close", () => runSync(forget(notice)));
      notice.on("click", () => {
        runSync(forget(notice));
        host.bringToFront();
        // The gallery puts the videos whose agent asks first.
        host.sendAppCommand("board");
      });
      notice.show();
    });

  const update = (next: unknown) =>
    Option.match(decodeAttention(next), {
      onNone: () => Effect.void,
      onSome: (attention) =>
        Effect.gen(function* () {
          app.setBadgeCount(attention.waiting);
          yield* Ref.set(busyWork, attention.busy);

          const away = BrowserWindow.getFocusedWindow() === null && Notification.isSupported();
          const changes = askingChanges(yield* Ref.get(asking), attention.asking, away);

          yield* Effect.forEach(changes.notify, notify, { discard: true });

          // What was answered, wherever, no longer waits in Notification Center.
          for (const [notice, key] of yield* Ref.get(shown)) {
            if (!changes.now.has(key)) notice.close();
          }

          yield* Ref.set(asking, changes.now);
        }),
    });

  ipcMain.on(ATTENTION_CHANNEL, (event, next) => {
    if (host.isFromApp(event)) Effect.runSync(update(next));
  });
}
