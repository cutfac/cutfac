import { Effect, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { BRIEF_FILE, BriefPatch, PLATFORMS, PURPOSES, updateBrief } from "../core/brief.ts";
import { Workspace } from "../core/workspace.ts";
import { asJson, describe, tool } from "./tool.ts";

const UpdateBrief = tool("update_brief", {
  description:
    "Change the workspace brief (brief.md): what the videos are for, where they go, and the user's own words " +
    "about them. Call it when the user says something that changes these, then tell them what changed in one line. " +
    "What you leave out stays as it is.",
  parameters: BriefPatch,
  success: Schema.Struct({
    path: Schema.String.annotate(describe("absolute path of brief.md")),
    purpose: Schema.optional(Schema.Literals(PURPOSES)),
    platforms: Schema.Array(Schema.Literals(PLATFORMS)),
    body: Schema.String,
  }),
  overwrites: true,
  idempotent: true,
});

/** The tools for the workspace brief, kept apart from the rest so each module stays one concern. */
export const BriefToolkit = Toolkit.make(UpdateBrief);

export const briefHandlers = BriefToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;

    return BriefToolkit.of({
      update_brief: (patch) =>
        Effect.gen(function* () {
          const brief = yield* updateBrief(patch);

          return asJson({ path: yield* ws.abs(BRIEF_FILE), ...brief });
        }).pipe(Effect.provideService(Workspace, ws)),
    });
  }),
);
