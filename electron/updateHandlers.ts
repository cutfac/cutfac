import { Effect, Option } from "effect";
import { app, shell } from "electron";

import { isFromApp } from "./boardWindow.ts";
import {
  UPDATE_RENEW_CHANNEL,
  UPDATE_RESTART_CHANNEL,
  UPDATE_STATUS_CHANNEL,
  UPDATED_TO_CHANNEL,
} from "./ipc.ts";
import { ANY_INPUT } from "./ipcCall.ts";
import { answer } from "./ipcHandlers.ts";
import { License } from "./license.ts";
import { updatedTo } from "./settings.ts";
import { Updates } from "./updates.ts";

export interface UpdatesHost {
  /** Quits as the app always does, the board saying so, then runs `finish` as its last step. */
  quit: (finish: Effect.Effect<void>) => void;
  /** The board's language, for the renewal checkout. */
  locale: () => string;
}

/** What the board asks about updates, which it shows at the foot of its sidebar. */
export function handleUpdates(host: UpdatesHost): void {
  answer(UPDATE_STATUS_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.flatMap(Updates, (updates) => updates.status),
  );
  // The installer closes the windows as it takes over, so the app stops its work before that.
  answer(UPDATE_RESTART_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.flatMap(Updates, (updates) => updates.install).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.void,
          onSome: (install) => Effect.sync(() => host.quit(install)),
        }),
      ),
    ),
  );
  answer(UPDATE_RENEW_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.flatMap(License, (license) => license.renewal(host.locale())).pipe(
      Effect.flatMap(
        Option.match({
          onNone: () => Effect.succeed(false),
          onSome: (url) =>
            Effect.as(
              Effect.promise(() => shell.openExternal(url)),
              true,
            ),
        }),
      ),
    ),
  );
  answer(UPDATED_TO_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.map(updatedTo(app.getVersion()), Option.getOrUndefined),
  );
}
