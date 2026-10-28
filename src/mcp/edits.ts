import { Effect, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { resolveEdit } from "../core/edits.ts";
import { saveVariant } from "../core/editVariants.ts";
import { openFeedback } from "../core/items.ts";
import { Feedback, Variant } from "../core/schema.ts";
import { Workspace } from "../core/workspace.ts";
import { AbsDir, Id, Ok, describe, tool, toolRunner } from "./tool.ts";

const OpenFeedbackEntry = Schema.Struct({
  item: Schema.String,
  title: Schema.String,
  absDir: AbsDir,
  feedback: Feedback,
});

const ListOpenFeedback = tool("list_open_feedback", {
  description:
    "All unresolved edit requests the user left on the board, across items. Each can target a time range " +
    "(timecode → end, seconds) and a region (x, y, w, h as fractions of the frame at `at` seconds). " +
    "context holds item-relative files prepared for you: clip (the range), frame (red box = region), before (saved copy). " +
    "variants.wanted asks for that many versions to compare (see save_variant); variants.saved lists the ones saved so far. " +
    "Requests with `waiting` set, or a `run` still running, are the board's agent's; leave them unless the user asks.",
  success: Schema.Struct({ feedback: Schema.Array(OpenFeedbackEntry) }),
  readonly: true,
});

const ResolveFeedback = tool("resolve_feedback", {
  description:
    "Mark an edit request as handled and describe what changed. Call it after writing the edited media, and only then: " +
    "when you changed nothing and need the user's answer, ask in your reply and leave the request open. " +
    "the edited file is saved as the 'after' version the user compares and approves. " +
    "With versions saved by save_variant, the media goes back to how it was until the user picks one on the board.",
  parameters: Schema.Struct({ item: Id, feedbackId: Schema.String, resolution: Schema.String }),
  success: Ok,
});

const SaveVariant = tool("save_variant", {
  description:
    "Save the media file as it is now as one version of an edit request, for the user to compare side by side and pick from on the board. " +
    "Use it when the request asks for versions (variants.wanted), or when the user should choose between takes: render each version over the same file name, " +
    "then save it with a few words on how it differs. Saving under a label already used replaces that version. Call resolve_feedback once, after the last.",
  parameters: Schema.Struct({
    item: Id,
    feedbackId: Schema.String,
    label: Schema.String.annotate(
      describe("how this version differs, in a few words, such as 'big bold captions'"),
    ),
    media: Schema.optional(
      Schema.String.annotate(
        describe("the media file name; defaults to the request's file, or the item's only one"),
      ),
    ),
  }),
  success: Schema.Struct({
    variant: Variant,
    saved: Schema.Finite.annotate(describe("versions of the request saved so far")),
    wanted: Schema.optional(Schema.Finite.annotate(describe("versions the user asked for"))),
  }),
});

export const EditsToolkit = Toolkit.make(ListOpenFeedback, ResolveFeedback, SaveVariant);

export const editsHandlers = EditsToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    const itemAbs = (id: string) => ws.abs(`${ws.config.paths.items}/${id}`);

    return EditsToolkit.of({
      list_open_feedback: () =>
        run(
          Effect.gen(function* () {
            const open = yield* openFeedback();

            const feedback = yield* Effect.forEach(open, (entry) =>
              Effect.map(itemAbs(entry.item), (absDir) => ({ ...entry, absDir })),
            );

            return { feedback };
          }),
        ),

      resolve_feedback: ({ item, feedbackId, resolution }) =>
        run(Effect.as(resolveEdit(item, feedbackId, resolution), { ok: true } as const)),

      save_variant: ({ item, feedbackId, label, media }) =>
        run(
          Effect.map(saveVariant(item, feedbackId, label, media), ({ variant, saved, wanted }) => ({
            variant,
            saved,
            wanted,
          })),
        ),
    });
  }),
);
