import { Effect } from "effect";

import { saveCode } from "./editCode.ts";
import { afterFile, beforeFile, itemRel } from "./editFiles.ts";
import { pendingVariants } from "./editVariants.ts";
import { InvalidRequest } from "./errors.ts";
import { type MediaCapture, putBack, recordMedia } from "./history.ts";
import { type Item, findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import type { Feedback } from "./schema.ts";
import { isoMillis } from "./time.ts";
import { Workspace } from "./workspace.ts";

/**
 * Save the media as it is now: the request's file as its "before" side, with the agent's code
 * beside it, and the item's files in its history, so what the agent changes can be undone.
 * Returns the item-relative copy, if any.
 */
export const saveBefore = Effect.fnUntraced(function* (item: Item, f: Feedback) {
  const ws = yield* Workspace;
  const mediaName = f.media;

  if (mediaName === undefined) {
    const captures = item.media.map((m) => ({ media: m.name, start: true }));
    yield* recordMedia(item, captures, { cause: "outside" });

    return undefined;
  }

  if (!item.media.some((m) => m.name === mediaName)) {
    return yield* new InvalidRequest({ message: `${mediaName} is no longer on ${item.id}` });
  }

  const before = beforeFile(item, f.id, mediaName);
  yield* ws.copy(`${item.dir}/${mediaName}`, before);
  yield* saveCode(item, f.id);
  const file = itemRel(item, before);
  yield* recordMedia(item, [{ media: mediaName, file, start: true }], { cause: "outside" });

  return file;
});

/** When the request's changes start counting, in epoch milliseconds: when work on it began. */
export const baselineMillis = (f: Feedback) => isoMillis(f.baseline ?? f.at);

/**
 * Save the media as it is now as the "after" side, if it changed since the request.
 * Agents edit the media file in place, so a later request would otherwise lose this result.
 * Files the request changed are also saved into the item's history, so they can be undone.
 * While versions wait for the user's pick, the media is put back as it was instead.
 */
export const snapshotAfter = Effect.fn("edits.snapshotAfter")(function* (
  id: string,
  feedbackId: string,
) {
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);

  if (f.decision !== undefined) return item;

  // The media stays as it was until the user picks one of the versions.
  if (pendingVariants(f)) {
    yield* putBack(item, f.variants.media);

    return yield* getItem(id);
  }

  const after = yield* saveAfter(item, f);

  const captures = item.media.map(({ name }): MediaCapture => {
    if (name !== f.media) return { media: name, start: f.media === undefined };

    return after === undefined
      ? { media: name }
      : { media: name, file: after, base: f.context?.before };
  });

  yield* recordMedia(item, captures, { cause: "edit", feedbackId });

  if (after === undefined) return item;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => ({
      ...entry,
      context: { ...entry.context, after },
    })),
  );
});

/** Copy the request's media to its "after" file once it changed. Returns the item-relative copy. */
const saveAfter = Effect.fnUntraced(function* (item: Item, f: Feedback) {
  const ws = yield* Workspace;
  const mediaName = f.media;

  if (mediaName === undefined || f.context?.before === undefined || f.context.after !== undefined) {
    return undefined;
  }

  const source = `${item.dir}/${mediaName}`;

  if (!(yield* ws.exists(source))) return undefined;
  const { mtime } = yield* ws.stat(source);

  if (mtime <= baselineMillis(f)) return undefined;
  const after = afterFile(item, f.id, mediaName);
  yield* ws.copy(source, after);

  return itemRel(item, after);
});
