import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
} from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import type { CliEntry } from "../core/agents.ts";
import { ImportRuns } from "../core/importRun.ts";
import { agentRoutes } from "./agents.ts";
import { approvalRoutes } from "./approvals.ts";
import { briefRoutes } from "./brief.ts";
import { editRoutes } from "./edits.ts";
import { fileRoutes } from "./files.ts";
import { requestGuard } from "./guard.ts";
import { historyRoutes } from "./history.ts";
import { importRoutes } from "./imports.ts";
import { itemRoutes } from "./items.ts";
import { learnedRoutes } from "./learned.ts";
import { renderRoutes } from "./render.ts";
import { reportRoutes } from "./reports.ts";
import { workspaceRoutes } from "./workspace.ts";

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
  HttpRouter.add(
    "*",
    "/api/*",
    HttpServerResponse.jsonUnsafe({ error: "No such API route" }, { status: 404 }),
  ),
);

/** Every route of the board's API, the workspace files, and the board itself. */
export const routes = (options: ServerOptions) => {
  const api = Layer.mergeAll(
    staticRoutes,
    workspaceRoutes,
    agentRoutes(options.cli),
    itemRoutes,
    editRoutes,
    historyRoutes,
    approvalRoutes,
    renderRoutes,
    importRoutes(options.cli),
    learnedRoutes,
    reportRoutes,
    briefRoutes,
    fileRoutes,
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
        // The board's event stream never ends by itself, so a stop that waited on it would hold the
        // app's quit until the app killed the server, before it stopped its agents and renders.
        gracefulShutdownTimeout: "1 second",
      }),
    ),
  );
