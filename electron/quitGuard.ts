import { Effect, Ref } from "effect";
import { app, autoUpdater, type BrowserWindow, dialog, powerMonitor } from "electron";

import type { Locale } from "../web/src/i18n/locale.ts";
import { MESSAGES } from "./messages.ts";
import { busyWork, quitQuestion } from "./quitQuestion.ts";

interface QuitGuardHost {
  /** The board's window, for the question to sit on as a sheet. */
  window: () => BrowserWindow | undefined;
  locale: () => Locale;
}

const confirmQuit = (host: QuitGuardHost) =>
  Effect.gen(function* () {
    const messages = MESSAGES[host.locale()];
    const work = yield* Ref.get(busyWork);

    const options = {
      type: "warning" as const,
      message: messages.quitBusy(work),
      detail: messages.quitBusyDetail,
      buttons: [messages.quitAnyway, messages.keepWorking],
      defaultId: 1,
      cancelId: 1,
    };

    const window = host.window();

    const { response } = yield* Effect.promise(() =>
      window === undefined || window.isDestroyed()
        ? dialog.showMessageBox(options)
        : dialog.showMessageBox(window, options),
    );

    return response === 0;
  });

export function guardQuit(host: QuitGuardHost): (window: BrowserWindow) => void {
  const question = Effect.runSync(quitQuestion(Ref.get(busyWork), confirmQuit(host)));
  const settle = () => Effect.runSync(question.settle);

  process.on("SIGTERM", settle);
  process.on("SIGINT", settle);
  autoUpdater.on("before-quit-for-update", settle);
  void app.whenReady().then(() => powerMonitor.on("shutdown", settle));

  const hold = (event: Electron.Event, go: () => void) => {
    if (!Effect.runSync(question.mustAsk)) return;

    event.preventDefault();
    void Effect.runPromise(question.ask).then((quit) => quit && go());
  };

  app.on("before-quit", (event) => hold(event, () => app.quit()));

  return (window) => void window.on("close", (event) => hold(event, () => window.close()));
}
