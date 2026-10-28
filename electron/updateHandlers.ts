import { Effect, Option } from "effect";
import { app } from "electron";

import { isFromApp } from "./boardWindow.ts";
import { UPDATE_RESTART_CHANNEL, UPDATE_STATUS_CHANNEL, UPDATED_TO_CHANNEL } from "./ipc.ts";
import { ANY_INPUT } from "./ipcCall.ts";
import { answer } from "./ipcHandlers.ts";
import { loadSeenVersion, saveSeenVersion } from "./settings.ts";
import { Updates } from "./updates.ts";

/** The version the app updated to since the board last asked, once; none on a first launch. */
const updatedTo = Effect.gen(function* () {
  const seen = yield* loadSeenVersion;
  const running = app.getVersion();

  if (Option.contains(seen, running)) return undefined;

  yield* Effect.ignore(saveSeenVersion(running), {
    log: "Warn",
    message: "The version wasn't saved",
  });

  return Option.isSome(seen) ? running : undefined;
});

/** What the board asks about updates, which it shows at the foot of its sidebar. */
export function handleUpdates(): void {
  answer(UPDATE_STATUS_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.flatMap(Updates, (updates) => updates.status),
  );
  answer(UPDATE_RESTART_CHANNEL, isFromApp, ANY_INPUT, () =>
    Effect.flatMap(Updates, (updates) => updates.restart),
  );
  answer(UPDATED_TO_CHANNEL, isFromApp, ANY_INPUT, () => updatedTo);
}
