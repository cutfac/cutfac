import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { errorCount, recentLogs } from "../core/feedbackLogs.ts";
import { sendTeamFeedback } from "../core/teamFeedback.ts";
import { Workspace } from "../core/workspace.ts";
import {
  type ReportSettings,
  feedbackInstallId,
  reportSettings,
  resetInstallId,
  setReportChoices,
} from "../errorReports.ts";
import { trackUsage } from "../usageStats.ts";
import { defaultAgent } from "./agents.ts";
import { json } from "./respond.ts";

/** Feedback for the Cutfac team, from the board's dialog or a `/feedback` message. */
const TeamFeedbackBody = Schema.Struct({
  message: Schema.String,
  email: Schema.optional(Schema.String),
  source: Schema.Literals(["board", "slash"]),
  platform: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.Boolean),
});

/** What the person chose to send; a choice left out stays as it was. */
const ReportChoicesBody = Schema.Struct({
  errorReports: Schema.optionalKey(Schema.Boolean),
  usageStats: Schema.optionalKey(Schema.Boolean),
});

/** How the desktop app's first launch went, which the board hands on once the workspace is up. */
const OnboardingFinishedBody = Schema.Struct({
  screen_recording: Schema.Boolean,
  accessibility: Schema.Boolean,
});

/** The error report and usage statistics settings as the board reads them. */
const reportView = ({ available, errorReports, usageStats, installId }: ReportSettings) => ({
  available,
  errorReports: Option.getOrNull(errorReports),
  usageStats: Option.getOrNull(usageStats),
  installId: Option.getOrNull(installId),
});

export const reportRoutes = HttpRouter.addAll([
  json(
    "POST",
    "/api/team-feedback",
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const { logs, ...body } = yield* HttpServerRequest.schemaBodyJson(TeamFeedbackBody);

      yield* sendTeamFeedback({
        ...body,
        withLogs: logs,
        agent: body.agent ?? defaultAgent(ws),
        install: Option.getOrUndefined(yield* feedbackInstallId(logs)),
      });

      return { ok: true };
    }),
  ),
  json(
    "GET",
    "/api/team-feedback/logs",
    Effect.map(recentLogs, (logs) => ({
      logs: Option.getOrNull(logs),
      errors: Option.match(logs, { onNone: () => 0, onSome: errorCount }),
    })),
  ),
  json("GET", "/api/error-reports", Effect.map(reportSettings, reportView)),
  json(
    "POST",
    "/api/error-reports",
    Effect.flatMap(HttpServerRequest.schemaBodyJson(ReportChoicesBody), (choices) =>
      Effect.map(setReportChoices(choices), reportView),
    ),
  ),
  json("POST", "/api/error-reports/install-id", Effect.map(resetInstallId(), reportView)),
  json(
    "POST",
    "/api/usage/onboarding-finished",
    Effect.flatMap(HttpServerRequest.schemaBodyJson(OnboardingFinishedBody), (went) =>
      Effect.as(trackUsage("onboarding_finished", went), { ok: true }),
    ),
  ),
]);
