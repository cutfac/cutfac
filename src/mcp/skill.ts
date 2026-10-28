import { Effect, Layer, Schema } from "effect";
import { Toolkit } from "effect/ai";

import {
  BUNDLED_SKILL,
  type SkillCopy,
  SkillState,
  isStale,
  skillCopies,
  syncSkill,
} from "../core/skill.ts";
import { Workspace } from "../core/workspace.ts";
import { describe, tool, toolRunner } from "./tool.ts";

// Absolute paths, so the agent can write a copy without knowing the workspace root.
export const absoluteCopies = Effect.fn("mcpSkill.absoluteCopies")(function* (
  copies: ReadonlyArray<SkillCopy>,
) {
  const ws = yield* Workspace;

  return yield* Effect.forEach(copies, (copy) =>
    Effect.map(ws.abs(copy.path), (path) => ({ ...copy, path })),
  );
});

const GetSkill = tool("get_skill", {
  description:
    "The cutfac skill this version of Cutfac ships, and the workspace's copies of it. " +
    "Missing and outdated copies are replaced on their own; an edited copy is the user's, so change it only with their consent.",
  success: Schema.Struct({
    markdown: Schema.String.annotate(describe("the bundled SKILL.md")),
    copies: Schema.Array(
      Schema.Struct({
        path: Schema.String.annotate(describe("absolute path of the copy")),
        state: SkillState,
      }),
    ),
  }),
  readonly: true,
});

export const SkillToolkit = Toolkit.make(GetSkill);

export const skillHandlers = SkillToolkit.toLayer(
  Effect.gen(function* () {
    const run = yield* toolRunner;

    return SkillToolkit.of({
      get_skill: () =>
        run(
          Effect.map(Effect.flatMap(skillCopies(), absoluteCopies), (copies) => ({
            markdown: BUNDLED_SKILL.markdown,
            copies,
          })),
        ),
    });
  }),
);

/**
 * Gives a workspace made by an earlier version the current skill before the server takes requests,
 * so the agent reads it from its first task. A copy that could not be written shows up in
 * workspace_overview's notices instead, and serving goes on.
 */
export const SkillSync = Layer.effectDiscard(
  syncSkill().pipe(
    Effect.flatMap((copies) =>
      Effect.forEach(
        copies.filter(isStale),
        (copy) => Effect.logInfo(`Wrote the cutfac skill to ${copy.path}`),
        { discard: true },
      ),
    ),
    Effect.catchTag("WorkspaceError", (error) => Effect.logWarning(error.message)),
  ),
);
