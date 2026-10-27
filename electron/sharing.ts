import { Effect, Option } from "effect";
import { app } from "electron";

import { AppData } from "../src/core/appData.ts";
import { reportSettings } from "../src/errorReports.ts";
import { runInMain } from "./runtime.ts";

/**
 * Whether this build can share error reports and usage statistics with the Cutfac team, and the
 * person's one answer for both: null until they give it, or after they gave different ones. The
 * first launch asks before there is a workspace; the board saves the answer once there is one.
 */
export const sharingChoice = () =>
  runInMain(
    Effect.map(reportSettings, ({ available, errorReports, usageStats }) => ({
      available,
      share:
        Option.isSome(errorReports) && Option.isSome(usageStats)
          ? errorReports.value && usageStats.value
          : null,
    })).pipe(Effect.provideService(AppData, Option.some(app.getPath("userData")))),
  );
