import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Option, Schema, Stream } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";

import { readAbout } from "../core/about.ts";
import { RunRegistry } from "../core/agentRun.ts";
import type { CliEntry } from "../core/agents.ts";
import { errorCount, recentLogs } from "../core/feedbackLogs.ts";
import { formatStatuses } from "../core/formatSpec.ts";
import { ImportRuns } from "../core/importRun.ts";
import { openFeedback } from "../core/items.ts";
import { forget, learn, learnInputOf, listLearned } from "../core/learn.ts";
import { getFormat, listFormats } from "../core/library.ts";
import { sendTeamFeedback } from "../core/teamFeedback.ts";
import { Workspace } from "../core/workspace.ts";
import {
  type ReportSettings,
  feedbackInstallId,
  reportSettings,
  resetInstallId,
  setReportChoices,
} from "../errorReports.ts";
import { planStatus } from "../plan.ts";
import { trackUsage } from "../usageStats.ts";
import { agentRoutes, defaultAgent } from "./agents.ts";
import { approvalRoutes } from "./approvals.ts";
import { briefRoutes } from "./brief.ts";
import { editRoutes } from "./edits.ts";
import { fileRoutes } from "./files.ts";
import { requestGuard } from "./guard.ts";
import { historyRoutes } from "./history.ts";
import { importRoutes } from "./imports.ts";
import { itemRoutes } from "./items.ts";
import { renderChanges, renderRoutes } from "./render.ts";
import { json, withId } from "./respond.ts";
import { eventStream, sseEvent } from "./sse.ts";
import { isMultipart, MediaForm } from "./uploads.ts";

export interface ServerOptions {
  /** The built board, served at `/`. Without it the server is API-only. */
  readonly webDir?: string | undefined;
  /** How agents should launch this CLI, for registering the MCP server from the board. */
  readonly cli?: CliEntry | undefined;
}

export interface ListenOptions extends ServerOptions {
  readonly port: number;
  readonly hostname: string;
}

/** Uploads are whole videos, far past Bun's 128 MB default. */
const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

// ---------------------------------------------------------------------------------------------
// Responses

const notFound = HttpServerResponse.jsonUnsafe({ error: "No such API route" }, { status: 404 });

// ---------------------------------------------------------------------------------------------
// Request inputs

const LearnBody = Schema.Struct({ source: Schema.NonEmptyString });

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

// ---------------------------------------------------------------------------------------------
// Items

/** Everything learned, newest first, with about.md as agents read it. */
const learnedList = Effect.all(
  { learned: listLearned(), about: Effect.map(readAbout(), Option.getOrUndefined) },
  { concurrency: "unbounded" },
);

const workspaceInfo = Effect.gen(function* () {
  const ws = yield* Workspace;

  const [formats, feedback] = yield* Effect.all([listFormats(), openFeedback()], {
    concurrency: "unbounded",
  });

  return {
    name: ws.config.name,
    root: ws.root,
    config: ws.config,
    formats,
    openFeedback: feedback.length,
  };
});

// ---------------------------------------------------------------------------------------------
// Server-sent events

/**
 * Workspace paths that changed on disk, renders starting or ending, and items whose agent asks the
 * board or has its asking settled, so agent work appears without a reload.
 */
const changesRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const renders = yield* renderChanges;
  const runs = yield* RunRegistry;

  return eventStream(
    Stream.mergeAll(
      [
        Stream.map(ws.changes, (path) => sseEvent("change", path)),
        renders,
        Stream.map(runs.asks, (id) => sseEvent("change", id)),
      ],
      { concurrency: "unbounded" },
    ),
  );
});

// ---------------------------------------------------------------------------------------------
// Routes

/** The board's API and the workspace files it loads. */
const apiRoutes = HttpRouter.addAll([
  json("GET", "/api/workspace", workspaceInfo),
  json("GET", "/api/plan", planStatus()),

  json("GET", "/api/feedback", openFeedback()),
  json("GET", "/api/learned", learnedList),
  json(
    "POST",
    "/api/learn",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (isMultipart(request)) {
        const { file } = yield* HttpServerRequest.schemaBodyMultipart(MediaForm);

        return yield* learn({ file: file.path, name: file.name });
      }

      const body = yield* HttpServerRequest.schemaBodyJson(LearnBody);

      return yield* learn(learnInputOf(body.source));
    }),
  ),
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
  json("POST", "/api/learned/forget", Effect.andThen(withId(forget), learnedList)),
  json("GET", "/api/formats", listFormats()),
  json("GET", "/api/formats/status", formatStatuses()),
  json("GET", "/api/format", withId(getFormat)),
  HttpRouter.route("GET", "/api/events", changesRoute),
]);

/** The built board, with unknown paths falling back to its index for client-side routing. */
const boardRoutes = (webDir: string) =>
  HttpRouter.addAll(
    Effect.map(HttpStaticServer.make({ root: webDir, spa: true }), (handler) => [
      HttpRouter.route("GET", "*", Effect.catch(handler, HttpServerRespondable.toResponse)),
    ]),
  );

/**
 * Routes that need nothing are added on their own: in a route list they would widen the list's
 * error and requirement types to `any`.
 */
const staticRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/health", HttpServerResponse.jsonUnsafe({ ok: true })),
  HttpRouter.add("*", "/api/*", notFound),
);

/** Every route of the board's API, the workspace files, and the board itself. */
export const routes = (options: ServerOptions) => {
  const api = Layer.mergeAll(
    staticRoutes,
    apiRoutes,
    agentRoutes(options.cli),
    itemRoutes,
    editRoutes,
    importRoutes(options.cli),
    fileRoutes,
    briefRoutes,
    renderRoutes,
    historyRoutes,
    approvalRoutes,
  );

  return options.webDir === undefined ? api : Layer.merge(api, boardRoutes(options.webDir));
};

/** The board and its API on a local port. Needs the workspace; brings everything else. */
export const serverLayer = (options: ListenOptions) =>
  HttpRouter.serve(Layer.merge(routes(options), requestGuard(options.hostname)), {
    disableLogger: true,
  }).pipe(
    Layer.provide(Layer.mergeAll(RunRegistry.layer(options.cli), ImportRuns.layer)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      BunHttpServer.layer({
        port: options.port,
        hostname: options.hostname,
        maxRequestBodySize: MAX_UPLOAD_BYTES,
        // Uploads, ffmpeg-backed requests, and event streams all outlast Bun's 10 s default.
        idleTimeout: 0,
      }),
    ),
  );
