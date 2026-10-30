import { Effect, type Types } from "effect";

import { pruneVersions, verdictOn } from "./editVariants.ts";
import { InvalidRequest, NotFound } from "./errors.ts";
import { capture, putVersion, versionOf } from "./historyMedia.ts";
import {
  DETAIL_FIELDS,
  type DetailField,
  type DetailValues,
  type HistoryDoc,
  type HistoryEntry,
  madeBy,
  type MediaVersion,
  type VersionCause,
} from "./historySchema.ts";
import { mutateHistory, pushEntry, type SaveHistory } from "./historyStore.ts";
import { type Decision, type Item, getItem, mutateItem, shortId, updateItem } from "./items.ts";
import { type Feedback, type ItemDoc, type ItemPatch, type ItemStatus } from "./schema.ts";
import { nowIso } from "./time.ts";

interface DetailSource {
  readonly title?: string | undefined;
  readonly status?: ItemStatus | undefined;
  readonly hook?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

const valueOf = (source: DetailSource, field: DetailField) => source[field] ?? null;

function pickDetails(source: DetailSource, fields: ReadonlySet<DetailField>): DetailValues {
  const values: Types.Mutable<DetailValues> = {};

  if (fields.has("title") && source.title !== undefined) values.title = source.title;

  if (fields.has("status") && source.status !== undefined) values.status = source.status;

  if (fields.has("hook")) values.hook = source.hook ?? null;

  if (fields.has("notes")) values.notes = source.notes ?? null;

  return values;
}

const optionalField = (value: string | null | undefined, current: string | undefined) =>
  value === undefined ? current : (value ?? undefined);

export function applyDetails(doc: ItemDoc, values: DetailValues): ItemDoc {
  return {
    ...doc,
    title: values.title ?? doc.title,
    status: values.status ?? doc.status,
    hook: optionalField(values.hook, doc.hook),
    notes: optionalField(values.notes, doc.notes),
  };
}

/** The fields of `target` that still hold `expected`. A field changed since is left alone. */
export function stillAt(doc: ItemDoc, expected: DetailValues, target: DetailValues): DetailValues {
  const fields = DETAIL_FIELDS.filter(
    (field) => target[field] !== undefined && valueOf(expected, field) === valueOf(doc, field),
  );

  return pickDetails(target, new Set(fields));
}

/** Update item fields and record the change so it can be undone. */
export const updateDetails = Effect.fn("history.updateDetails")(function* (
  id: string,
  patch: ItemPatch,
) {
  const located = yield* getItem(id);

  const updated = yield* mutateHistory(located, (history, save) =>
    Effect.gen(function* () {
      // Read inside the lock, so it is the item as the change before this one left it.
      const before = yield* getItem(id);
      const item = yield* updateItem(id, patch);

      const changed = new Set(
        DETAIL_FIELDS.filter((field) => valueOf(before.doc, field) !== valueOf(item.doc, field)),
      );

      if (changed.size === 0) return item;

      const entry: HistoryEntry = {
        kind: "details",
        id: yield* shortId,
        at: yield* nowIso,
        before: pickDetails(before.doc, changed),
        after: pickDetails(item.doc, changed),
      };

      yield* save(pushEntry(history, entry));

      return item;
    }),
  );

  // A done video won't switch versions any more, so the ones not kept go.
  return patch.status === "done" ? yield* pruneVersions(id) : updated;
});

// ---------------------------------------------------------------------------------------------
// Undo and redo

type Direction = "undo" | "redo";

/** The verdict on a request that matches the side of it now in the file. */
const VERDICTS: Record<Direction, Partial<Record<VersionCause, Decision>>> = {
  undo: { edit: "restored", restore: "approved" },
  redo: { edit: "approved", restore: "restored" },
};

/** Record the verdict on a request about `media` that leaves its file holding `file`. */
const decide = Effect.fnUntraced(function* (
  item: Item,
  feedbackId: string,
  media: string,
  decision: Decision,
  file = "",
) {
  const now = yield* nowIso;

  // Only the request about this media file gets a verdict; a request about the whole item can
  // change several files.
  const decided = (f: Feedback) => f.id === feedbackId && f.media === media;

  yield* mutateItem(item.id, (current) =>
    Effect.succeed({
      ...current,
      feedback: current.feedback.map((f) => (decided(f) ? verdictOn(f, decision, file, now) : f)),
    }),
  );
});

const applyEntry = Effect.fnUntraced(function* (
  item: Item,
  doc: HistoryDoc,
  entry: HistoryEntry,
  direction: Direction,
) {
  if (entry.kind === "details") {
    const [expected, target] =
      direction === "undo" ? [entry.after, entry.before] : [entry.before, entry.after];

    const current = yield* getItem(item.id);
    const values = stillAt(current.doc, expected, target);

    if (Object.keys(values).length > 0) {
      yield* mutateItem(item.id, (next) => Effect.succeed(applyDetails(next, values)));
    }

    return doc;
  }

  const landing = direction === "undo" ? entry.from : entry.to;
  const next = yield* putVersion(item, doc, landing);
  const decision = VERDICTS[direction][entry.cause];

  if (entry.feedbackId !== undefined && decision !== undefined) {
    yield* decide(item, entry.feedbackId, entry.media, decision, versionOf(next, landing)?.file);
  }

  return next;
});

/** Undo or redo until the first `target` entries are applied, saving each step as it lands. */
const travel = Effect.fnUntraced(function* (
  item: Item,
  start: HistoryDoc,
  target: number,
  save: SaveHistory,
) {
  let doc = start;

  while (doc.cursor !== target) {
    const direction: Direction = doc.cursor > target ? "undo" : "redo";
    const index = direction === "undo" ? doc.cursor - 1 : doc.cursor;
    const entry = doc.entries[index];

    if (entry === undefined) break;
    const applied = yield* applyEntry(item, doc, entry, direction);
    doc = { ...applied, cursor: direction === "undo" ? index : index + 1 };
    yield* save(doc);
  }
});

/**
 * Change an item's history, with tracked media changed outside a request saved as entries first.
 * Returns the item afterwards.
 */
const mutateSynced = Effect.fnUntraced(function* <E, R>(
  id: string,
  change: (item: Item, doc: HistoryDoc, save: SaveHistory) => Effect.Effect<void, E, R>,
) {
  const item = yield* getItem(id);

  yield* mutateHistory(item, (doc, save) =>
    Effect.gen(function* () {
      const tracked = Object.keys(doc.heads).map((media) => ({ media }));
      const next = yield* capture(item, doc, tracked, { cause: "outside" });

      if (next !== doc) yield* save(next);

      return yield* change(item, next, save);
    }),
  );

  return yield* getItem(id);
});

export const undo = Effect.fn("history.undo")((id: string) =>
  mutateSynced(id, (item, doc, save) =>
    doc.cursor === 0
      ? Effect.fail(new InvalidRequest({ message: "Nothing to undo" }))
      : travel(item, doc, doc.cursor - 1, save),
  ),
);

export const redo = Effect.fn("history.redo")((id: string) =>
  mutateSynced(id, (item, doc, save) =>
    doc.cursor >= doc.entries.length
      ? Effect.fail(new InvalidRequest({ message: "Nothing to redo" }))
      : travel(item, doc, doc.cursor + 1, save),
  ),
);

/**
 * Put an earlier version back in its media file, as a new version and a change that can be undone.
 * A version a request put in leaves the request decided as it was then.
 */
export const restoreVersion = Effect.fn("history.restoreVersion")((id: string, versionId: string) =>
  mutateSynced(id, (item, doc, save) =>
    Effect.gen(function* () {
      const picked = versionOf(doc, versionId);

      if (picked === undefined) {
        return yield* new NotFound({ message: `Version ${versionId} not found on ${id}` });
      }

      const head = doc.heads[picked.media];

      if (versionOf(doc, head?.version)?.file === picked.file) return;

      const version: MediaVersion = {
        id: yield* shortId,
        media: picked.media,
        file: picked.file,
        at: yield* nowIso,
        size: picked.size,
        cause: "version",
        source: picked.id,
      };

      const placed = yield* putVersion(
        item,
        { ...doc, versions: [...doc.versions, version] },
        version.id,
      );

      yield* save(
        head === undefined
          ? placed
          : pushEntry(placed, {
              kind: "media",
              id: yield* shortId,
              at: version.at,
              media: picked.media,
              from: head.version,
              to: version.id,
              cause: "version",
            }),
      );

      const made = madeBy(doc.versions, picked);
      const decision = made.cause === undefined ? undefined : VERDICTS.redo[made.cause];

      if (made.feedbackId !== undefined && decision !== undefined) {
        yield* decide(item, made.feedbackId, made.media, decision, picked.file);
      }
    }),
  ),
);
