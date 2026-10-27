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
  const question = Effect.runSync(quitQuestion(Ref.get(busyWork), confirmQuit(host)));
  const settle = () => Effect.runSync(question.settle);

  process.on("SIGTERM", settle);
  process.on("SIGINT", settle);
  autoUpdater.on("before-quit-for-update", settle);
  void app.whenReady().then(() => powerMonitor.on("shutdown", settle));

  /** Holds `event` for the question when it must be asked, then does `go` if the answer is quit. */
  const hold = (event: Electron.Event, go: () => void) => {
    if (!Effect.runSync(question.mustAsk)) return;

    event.preventDefault();
    void Effect.runPromise(question.ask).then((quit) => quit && go());
  };

  app.on("before-quit", (event) => hold(event, () => app.quit()));

  guard = (window) => window.on("close", (event) => hold(event, () => window.close()));
}

/** Asks before the board's window closes while work goes on, since closing it quits the app. */
export const guardWindow = (window: BrowserWindow) => guard(window);
