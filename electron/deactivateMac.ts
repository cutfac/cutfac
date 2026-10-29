import { Effect } from "effect";
import { type BrowserWindow, dialog, type MessageBoxOptions } from "electron";

import { License } from "./license.ts";
import type { Messages } from "./messages.ts";

const show = (owner: BrowserWindow | undefined, options: MessageBoxOptions) =>
  Effect.promise(() =>
    owner ? dialog.showMessageBox(owner, options) : dialog.showMessageBox(options),
  );

/**
 * Asks, then frees this Mac's license activation and forgets the key, so it can be activated on
 * another Mac. Offline, nothing changes: forgetting the key alone would leave this Mac counted.
 */
export const deactivateThisMac = (t: Messages, owner: BrowserWindow | undefined) =>
  Effect.gen(function* () {
    const license = yield* License;

    if (!(yield* license.hasKey)) {
      yield* show(owner, { type: "info", message: t.noLicenseKey });

      return;
    }

    const { response } = yield* show(owner, {
      type: "question",
      message: t.deactivateAsk,
      detail: t.deactivateDetail,
      buttons: [t.deactivate, t.deactivateCancel],
      defaultId: 1,
      cancelId: 1,
    });

    if (response !== 0) return;

    const result = yield* license.deactivate.pipe(
      Effect.tapError((error) =>
        Effect.logWarning("The deactivated license wasn't saved", error.cause),
      ),
      Effect.orElseSucceed(() => "unavailable" as const),
    );

    yield* result === "deactivated"
      ? show(owner, { type: "info", message: t.deactivated, detail: t.deactivatedDetail })
      : show(owner, {
          type: "warning",
          message: t.deactivateFailed,
          detail: t.deactivateFailedDetail,
        });
  });
