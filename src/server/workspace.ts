import { Effect, Stream } from "effect";
import { HttpRouter } from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import { formatStatuses } from "../core/formatSpec.ts";
import { openFeedback } from "../core/items.ts";
import { getFormat, listFormats } from "../core/library.ts";
import { Workspace } from "../core/workspace.ts";
import { planStatus } from "../plan.ts";
import { renderChanges } from "./render.ts";
import { json, withId } from "./respond.ts";
import { eventStream, sseEvent } from "./sse.ts";

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

export const workspaceRoutes = HttpRouter.addAll([
  json("GET", "/api/workspace", workspaceInfo),
  json("GET", "/api/plan", planStatus()),
  json("GET", "/api/feedback", openFeedback()),
  json("GET", "/api/formats", listFormats()),
  json("GET", "/api/formats/status", formatStatuses()),
  json("GET", "/api/format", withId(getFormat)),
  HttpRouter.route("GET", "/api/events", changesRoute),
]);
