import { Effect } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { BRIEF_FILE, type Brief, BriefPatch, readBrief, updateBrief } from "../core/brief.ts";
import { Workspace } from "../core/workspace.ts";
import { json } from "./respond.ts";

/** The brief as the board edits it, with where it lives; `exists` is false until someone writes one. */
const briefView = (brief: Brief | undefined) =>
  Effect.map(
    Effect.flatMap(Workspace, (ws) => ws.abs(BRIEF_FILE)),
    (path) => ({
      path,
      exists: brief !== undefined,
      purpose: brief?.purpose ?? null,
      platforms: brief?.platforms ?? [],
      body: brief?.body ?? "",
    }),
  );

/** The workspace brief: what the videos are for and where they go. */
export const briefRoutes = HttpRouter.addAll([
  json("GET", "/api/brief", Effect.flatMap(readBrief(), briefView)),
  json(
    "PATCH",
    "/api/brief",
    HttpServerRequest.schemaBodyJson(BriefPatch).pipe(
      Effect.flatMap(updateBrief),
      Effect.flatMap(briefView),
    ),
  ),
]);
