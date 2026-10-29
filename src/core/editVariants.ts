import { Effect } from "effect";

import { saveCodeTo } from "./editCode.ts";
import { isKeptFile, itemRel, variantCodeDir, variantsDir } from "./editFiles.ts";
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
import { nowIso } from "./time.ts";
import { Workspace } from "./workspace.ts";

/** A request with versions saved, picked from or not. */
export type WithVersions = Feedback & {
  readonly variants: Variants & { readonly media: string };
};

/** Versions stay after one is kept, to switch to, until the item is done or exported. */
export const hasVersions = (f: Feedback): f is WithVersions =>
  f.variants?.media !== undefined && f.variants.saved.length > 0;

/** A request with versions saved that the user has not picked from yet. */
export const pendingVariants = (f: Feedback): f is WithVersions =>
  f.decision === undefined && hasVersions(f);

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

  // The code that rendered this version, since the agent goes on to change it for the next one.
  const code = variantCodeDir(item, f.id, variantId);
  yield* ws.remove(code);
  yield* saveCodeTo(item, code);

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

/** The user kept `picked`, whose copy is `after`; the other versions stay to switch to. */
export const markKept = Effect.fnUntraced(function* (
  item: Item,
  feedbackId: string,
  picked: string,
  after: string,
) {
  const now = yield* nowIso;

  return yield* mutateItem(item.id, (doc) =>
    updateFeedback(doc, item.id, feedbackId, (entry) =>
      withDecision(
        {
          ...entry,
          context: { ...entry.context, after },
          variants: { saved: [], ...entry.variants, picked },
        },
        "approved",
        now,
      ),
    ),
  );
});

/**
 * The verdict on a request once undo or redo leaves its media holding `file`: back on a version the
 * user kept, that version is kept again.
 */
export const verdictOn = (f: Feedback, decision: Decision, file: string, now: string) => {
  const version = f.variants?.saved.find((v) => isKeptFile(file, f.id, v.id));

  if (version === undefined || f.variants === undefined) return withDecision(f, decision, now);

  return withDecision(
    { ...f, variants: { ...f.variants, picked: version.label } },
    "approved",
    now,
  );
};

/**
 * Delete the versions the user didn't keep once the item is done or exported. Requests still
 * waiting for a pick keep theirs; the kept copies stay for undo.
 */
export const pruneVersions = Effect.fn("edits.pruneVersions")(function* (id: string) {
  const ws = yield* Workspace;
  const item = yield* getItem(id);

  const settled = new Set(
    item.doc.feedback.filter((f) => f.decision !== undefined && hasVersions(f)).map((f) => f.id),
  );

  if (settled.size === 0) return item;

  const next = yield* mutateItem(id, (doc) =>
    Effect.succeed({
      ...doc,
      feedback: doc.feedback.map((f) =>
        settled.has(f.id) && f.variants !== undefined
          ? { ...f, variants: { ...f.variants, saved: [] } }
          : f,
      ),
    }),
  );

  yield* Effect.forEach(settled, (feedbackId) => ws.remove(variantsDir(item, feedbackId)), {
    discard: true,
  });

  return next;
});
