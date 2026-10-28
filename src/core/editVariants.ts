import { Effect } from "effect";

import { itemRel, variantsDir } from "./editFiles.ts";
import { InvalidRequest } from "./errors.ts";
import {
  type Decision,
  type Item,
  findFeedback,
  getItem,
  mutateItem,
  shortId,
  updateFeedback,
  withDecision,
} from "./items.ts";
import { extension } from "./media.ts";
import { type Feedback, MAX_VARIANTS, type Variant, type Variants } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** A request with versions saved that the user has not picked from yet. */
export type PendingVariants = Feedback & {
  readonly variants: Variants & { readonly media: string };
};

export const pendingVariants = (f: Feedback): f is PendingVariants =>
  f.decision === undefined && f.variants?.media !== undefined && f.variants.saved.length > 0;

/**
 * The agent left versions to pick from or a result to keep or roll back, and the user hasn't
 * decided yet. It waits for them even after the request was resolved.
 */
export const awaitsDecision = (f: Feedback) =>
  pendingVariants(f) || (f.decision === undefined && f.context?.after !== undefined);

/** The file a version is of when the agent does not name one. */
const variantMedia = (item: Item, f: Feedback) =>
  f.variants?.media ?? f.media ?? (item.media.length === 1 ? item.media[0]?.name : undefined);

/**
 * Save the media as it is now as one version of a request, for the user to compare with the
 * others and pick from. Saving again under the same label replaces that version.
 */
export const saveVariant = Effect.fn("edits.saveVariant")(function* (
  id: string,
  feedbackId: string,
  label: string,
  mediaName?: string,
) {
  const ws = yield* Workspace;
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);
  const name = mediaName ?? variantMedia(item, f);
  const fixed = f.variants?.media ?? f.media;
  const title = label.trim();
  const saved = f.variants?.saved ?? [];
  const replaced = saved.find((v) => v.label === title);

  if (f.decision !== undefined) {
    return yield* new InvalidRequest({ message: `The user already decided on ${feedbackId}` });
  }

  if (title === "") return yield* new InvalidRequest({ message: "A version needs a label" });

  if (name === undefined) {
    return yield* new InvalidRequest({ message: "Name the media file this is a version of" });
  }

  if (fixed !== undefined && name !== fixed) {
    return yield* new InvalidRequest({ message: `Versions of this request are of ${fixed}` });
  }

  if (!item.media.some((m) => m.name === name)) {
    return yield* new InvalidRequest({ message: `No media named ${name} on ${id}` });
  }

  // While the user compares, the media goes back to how it was, so that has to be saved.
  if (f.media !== undefined && f.context?.before === undefined) {
    return yield* new InvalidRequest({
      message: `${feedbackId} has no saved before version to put back while the user compares`,
    });
  }

  if (replaced === undefined && saved.length >= MAX_VARIANTS) {
    return yield* new InvalidRequest({
      message: `A request holds at most ${MAX_VARIANTS} versions; save under a label already used to replace one`,
    });
  }

  const variantId = replaced?.id ?? (yield* shortId);
  const file = `${variantsDir(item, f.id)}/${variantId}.${extension(name)}`;
  yield* ws.copy(`${item.dir}/${name}`, file);

  const variant: Variant = {
    id: variantId,
    label: title,
    file: itemRel(item, file),
    at: yield* nowIso,
  };

  const next = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => {
      const current = entry.variants?.saved ?? [];

      const versions = current.some((v) => v.id === variantId)
        ? current.map((v) => (v.id === variantId ? variant : v))
        : [...current, variant];

      return { ...entry, variants: { ...entry.variants, media: name, saved: versions } };
    }),
  );

  const variants = (yield* findFeedback(next, feedbackId)).variants;

  return { item: next, variant, saved: variants?.saved.length ?? 0, wanted: variants?.wanted };
});

/**
 * Record the user's verdict on a request's versions, with the one kept, if any, then delete them.
 * The verdict goes first so a failed delete leaves stray files, not versions that point at nothing.
 */
export const closeVariants = Effect.fnUntraced(function* (
  item: Item,
  feedbackId: string,
  decision: Decision,
  picked?: string,
  after?: string,
) {
  const ws = yield* Workspace;
  const now = yield* nowIso;

  const next = yield* mutateItem(item.id, (doc) =>
    updateFeedback(doc, item.id, feedbackId, (entry) =>
      withDecision(
        {
          ...entry,
          context: after === undefined ? entry.context : { ...entry.context, after },
          variants: { ...entry.variants, saved: [], picked },
        },
        decision,
        now,
      ),
    ),
  );

  yield* ws.remove(variantsDir(item, feedbackId));

  return next;
});
