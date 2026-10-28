import { Effect, Schema } from "effect";
import { Toolkit } from "effect/ai";

import {
  DEFAULT_FRAMES,
  MAX_FRAMES,
  MAX_STRIPS,
  reviewChecklist,
  reviewMedia,
} from "../core/review.ts";
import { SafeZone } from "../core/reviewSchema.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace } from "../core/workspace.ts";
import { AbsDir, Id, describe, tool, toolRunner } from "./tool.ts";

const Check = Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.String });

const VerifyItem = tool("verify_item", {
  description:
    "ffprobe each video in the item and check codec, aspect, resolution, audio, stream start, and format rules.",
  parameters: Schema.Struct({ id: Id }),
  success: Schema.Struct({
    ok: Schema.Boolean.annotate(describe("every check on every video passed")),
    media: Schema.Array(
      Schema.Struct({ file: Schema.String, ok: Schema.Boolean, checks: Schema.Array(Check) }),
    ),
  }),
  readonly: true,
});

const ReviewShot = Schema.Struct({
  t: Schema.Finite.annotate(describe("seconds")),
  file: Schema.String.annotate(describe("relative to absDir")),
});

const Seconds = Schema.Array(Schema.Finite);

const ReviewMedia = tool("review_media", {
  description:
    "Render frames of an item's video so you judge what a viewer sees, not the code that made it: " +
    "a contact sheet of frames from the first to the last (left to right, top to bottom), each frame " +
    "larger, and a strip of six frames across each cut, where half-finished motion shows. On 9:16 " +
    "video the frames dim the top and bottom bands that platform UI covers. Open the sheet and " +
    "strips, go through the returned checklist, then name the three largest defects, each with its " +
    "time, what you see, and a local fix. Fix only those, render again, and review again. Replaces " +
    "the video's last review.",
  parameters: Schema.Struct({
    id: Id,
    file: Schema.String.annotate(describe("the video's file name in the item")),
    times: Schema.optional(
      Seconds.annotate(
        describe(
          `seconds to put on the sheet, up to ${MAX_FRAMES}; defaults to ${DEFAULT_FRAMES} spread evenly`,
        ),
      ),
    ),
    transitions: Schema.optional(
      Seconds.annotate(
        describe(
          `seconds to see the motion around, up to ${MAX_STRIPS}; defaults to detected cuts, [] for none`,
        ),
      ),
    ),
    safeZones: Schema.optional(
      Schema.Boolean.annotate(
        describe("false renders frames without the dimmed platform UI margins; defaults to true"),
      ),
    ),
  }),
  success: Schema.Struct({
    absDir: AbsDir,
    sheet: Schema.optional(Schema.String.annotate(describe("relative to absDir"))),
    frames: Schema.Array(ReviewShot),
    strips: Schema.Array(ReviewShot),
    safeZone: Schema.optional(
      SafeZone.annotate(
        describe(
          "the margins dimmed on the frames: top and bottom as fractions of the height, left and right of the width",
        ),
      ),
    ),
    notes: Schema.Array(Schema.String).annotate(describe("what could not be made or was left out")),
    checklist: Schema.Array(Schema.String).annotate(
      describe("what to check on the frames before you name the defects"),
    ),
  }),
  overwrites: true,
  idempotent: true,
});

export const ReviewToolkit = Toolkit.make(VerifyItem, ReviewMedia);

export const reviewHandlers = ReviewToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    return ReviewToolkit.of({
      verify_item: ({ id }) =>
        run(
          Effect.map(verifyItem(id), (media) => ({
            ok: media.every((report) => report.ok),
            media,
          })),
        ),

      review_media: ({ id, file, times, transitions, safeZones }) =>
        run(
          Effect.gen(function* () {
            const { dir, ...review } = yield* reviewMedia(id, file, {
              times,
              transitions,
              safeZones,
            });

            return { absDir: yield* ws.abs(dir), ...review, checklist: reviewChecklist(review) };
          }),
        ),
    });
  }),
);
