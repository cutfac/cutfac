import { Effect, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { ABOUT_FILE } from "../core/about.ts";
import { learn, learnInputOf } from "../core/learn.ts";
import { LearnedDoc, PreprocessResult } from "../core/learnedSchema.ts";
import { Workspace } from "../core/workspace.ts";
import { AbsDir, describe, tool, toolRunner } from "./tool.ts";

const Learn = tool("learn", {
  description:
    "Learn what the videos are about from a link (a landing page, an App Store or Google Play listing, a video post) " +
    "or a file or folder on this computer. Saves a first look into the returned folder (pictures, the video with its frames " +
    "and contact sheet) and adds a section for it to about.md. Then read the source more deeply and rewrite that section " +
    "with what matters for the videos.",
  parameters: Schema.Struct({
    source: Schema.String.annotate(describe("a link, or an absolute path to a file or folder")),
  }),
  success: Schema.Struct({
    id: Schema.String,
    absDir: AbsDir,
    doc: LearnedDoc,
    preprocess: Schema.optional(PreprocessResult),
    about: Schema.String.annotate(describe("absolute path of about.md")),
    warnings: Schema.Array(Schema.String),
  }),
  network: true,
});

export const LearnToolkit = Toolkit.make(Learn);

export const learnHandlers = LearnToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    return LearnToolkit.of({
      learn: ({ source }) =>
        run(
          Effect.gen(function* () {
            const { learned, warnings } = yield* learn(learnInputOf(source));

            return {
              id: learned.id,
              absDir: yield* ws.abs(learned.dir),
              doc: learned.doc,
              preprocess: learned.preprocess,
              about: yield* ws.abs(ABOUT_FILE),
              warnings,
            };
          }),
        ),
    });
  }),
);
