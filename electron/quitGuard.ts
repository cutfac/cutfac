import { app, autoUpdater, type BrowserWindow, dialog, powerMonitor } from "electron";

import type { Locale } from "../web/src/i18n/locale.ts";
import { busyCount } from "./attention.ts";
import { MESSAGES } from "./messages.ts";

interface QuitGuardHost {
  /** The board's window, for the question to sit on as a sheet. */
  window: () => BrowserWindow | undefined;
  locale: () => Locale;
}

/** The user said to quit anyway, or something other than the user is quitting the app. */
let settled = false;

const settle = () => (settled = true);

let asking: Promise<boolean> | undefined;

/** Holds a window's close for the question; set up by `guardQuit`. */
let guard: (window: BrowserWindow) => void = () => undefined;

/**
 * Asks before quitting, or closing the window, while an agent or a render is at work, since either
 * stops them. Nothing is asked when no one could answer: a signal, as the dev runner's restart sends,
 * the Mac shutting down, or an update installing.
 *
 * Call before the app's own `before-quit` listener, which leaves a quit this one held alone.
 */
export function guardQuit(host: QuitGuardHost): void {
  process.on("SIGTERM", settle);
  process.on("SIGINT", settle);
  autoUpdater.on("before-quit-for-update", settle);
  void app.whenReady().then(() => powerMonitor.on("shutdown", settle));

  const ask = (): Promise<boolean> => {
    asking ??= confirmQuit(host).then((quit) => {
      asking = undefined;

      if (quit) settle();

      return quit;
    });

    return asking;
  };

  app.on("before-quit", (event) => {
    if (settled || busyCount() === 0) return;

    event.preventDefault();
    void ask().then((quit) => quit && app.quit());
  });

  guard = (window) =>
    window.on("close", (event) => {
      if (settled || busyCount() === 0) return;

      event.preventDefault();
      void ask().then((quit) => quit && window.close());
    });
}

/** Asks before the board's window closes while work goes on, since closing it quits the app. */
export const guardWindow = (window: BrowserWindow) => guard(window);

async function confirmQuit(host: QuitGuardHost): Promise<boolean> {
  const messages = MESSAGES[host.locale()];

  const options = {
    type: "warning" as const,
    message: messages.quitBusy(busyCount()),
    detail: messages.quitBusyDetail,
    buttons: [messages.quitAnyway, messages.keepWorking],
    defaultId: 1,
    cancelId: 1,
  };

  const window = host.window();

  const { response } =
    window === undefined || window.isDestroyed()
      ? await dialog.showMessageBox(options)
      : await dialog.showMessageBox(window, options);

  return response === 0;
}
