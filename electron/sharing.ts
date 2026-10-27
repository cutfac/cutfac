import { Effect, Option } from "effect";

import { reportSettings } from "../src/errorReports.ts";
import type { Sharing } from "../web/src/desktop.ts";

/**
 * Whether this build can share error reports and usage statistics with the Cutfac team, and what
 * the person answered for each before. The first launch asks before there is a workspace; the
 * board saves the answers once there is one.
 */
export const sharingChoice = Effect.map(
  reportSettings,
  ({ available, errorReports, usageStats }): Sharing => ({
    available,
    errorReports: Option.getOrNull(errorReports),
    usageStats: Option.getOrNull(usageStats),
  }),
);
