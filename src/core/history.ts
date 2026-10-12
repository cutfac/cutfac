import { Effect, type Types } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import {
  type Decision,
  type Item,
  getItem,
  mutateItem,
  shortId,
  updateItem,
  withDecision,
} from "./items.ts";
import { extension } from "./media.ts";
import {
  DETAIL_FIELDS,
  type DetailField,
  type DetailValues,
  type Feedback,
  HistoryDoc,
  type HistoryEntry,
  type ItemDoc,
  type ItemPatch,
  type ItemStatus,
  type MediaCause,
  type MediaVersion,
} from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** Item subfolder with history.yaml and the media versions that are not edit snapshots. */
export const HISTORY_DIR = "history";

/** Changes kept for undo. Older ones drop off; the versions they point at stay listed. */
export const MAX_ENTRIES = 200;

const EMPTY: HistoryDoc = { cursor: 0, entries: [], versions: [], heads: {} };

const historyFile = (item: Item) => `${item.dir}/${HISTORY_DIR}/history.yaml`;

export const readHistory = Effect.fn("history.readHistory")(function* (item: Item) {
  const ws = yield* Workspace;
  const file = historyFile(item);

  return (yield* ws.exists(file)) ? yield* ws.readYaml(file, HistoryDoc) : EMPTY;
});

const writeHistory = Effect.fnUntraced(function* (item: Item, doc: HistoryDoc) {
  const ws = yield* Workspace;
  yield* ws.writeYaml(historyFile(item), HistoryDoc, doc);
});

/** Add a change at the cursor. Changes that could still have been redone are dropped. */
export function pushEntry(doc: HistoryDoc, entry: HistoryEntry): HistoryDoc {
  const entries = [...doc.entries.slice(0, doc.cursor), entry];
  const dropped = Math.max(0, entries.length - MAX_ENTRIES);

  return { ...doc, entries: entries.slice(dropped), cursor: entries.length - dropped };
}

// ---------------------------------------------------------------------------------------------
// Media versions

/** One media file to check against its history, with copies the caller already made. */
export interface MediaCapture {
  readonly media: string;
  /** Item-relative copy of the file as it is now. Without one, a changed file is copied. */
  readonly file?: string | undefined;
  /** Item-relative copy of the file before this change, for a file with no saved version yet. */
  readonly base?: string | undefined;
  /** Save a file with no saved version yet as its first version. */
  readonly start?: boolean | undefined;
}

/** Why tracked media changed, for the history entry. */
export interface Attribution {
  readonly cause: MediaCause;
  readonly feedbackId?: string | undefined;
}

const withVersion = (doc: HistoryDoc, version: MediaVersion): HistoryDoc =>
  doc.versions.some((v) => v.id === version.id)
    ? doc
    : { ...doc, versions: [...doc.versions, version] };

/** The saved version for `file`, reusing one that already points at it, or a new copy. */
const versionFor = Effect.fnUntraced(function* (
  item: Item,
  doc: HistoryDoc,
  media: string,
  file: string | undefined,
) {
  const ws = yield* Workspace;
  const existing = doc.versions.find((v) => v.media === media && v.file === file);

  if (existing !== undefined) return existing;
  const id = yield* shortId;
  const saved = file ?? `${HISTORY_DIR}/${id}.${extension(media)}`;

  if (file === undefined) yield* ws.copy(`${item.dir}/${media}`, `${item.dir}/${saved}`);
  const { size } = yield* ws.stat(`${item.dir}/${saved}`);
  const version: MediaVersion = { id, media, file: saved, at: yield* nowIso, size };

  return version;
});

/**
 * Save media files whose content is not a saved version yet. A tracked file that no longer
 * matches the version it should hold becomes a new version and a change from that version.
 */
const capture = Effect.fnUntraced(function* (
  item: Item,
  start: HistoryDoc,
  captures: ReadonlyArray<MediaCapture>,
  by: Attribution,
) {
  const ws = yield* Workspace;
  let doc = start;

  for (const { media, file, base, start: track } of captures) {
    const path = `${item.dir}/${media}`;

    if (!(yield* ws.exists(path))) continue;
    const { size, mtime } = yield* ws.stat(path);
    let head = doc.heads[media];

    if (head === undefined && base !== undefined) {
      const first = yield* versionFor(item, doc, media, base);
      doc = withVersion(doc, first);
      // An mtime no file has, so the file on disk is recorded as a change from the base.
      head = { version: first.id, size: first.size, mtime: -1 };
    }

    if (head === undefined && file === undefined && track !== true) continue;

    if (head !== undefined && head.size === size && head.mtime === mtime) continue;
    const version = yield* versionFor(item, doc, media, file);

    doc = {
      ...withVersion(doc, version),
      heads: { ...doc.heads, [media]: { version: version.id, size, mtime } },
    };

    if (head === undefined || head.version === version.id) continue;

    doc = pushEntry(doc, {
      kind: "media",
      id: yield* shortId,
      at: version.at,
      media,
      from: head.version,
      to: version.id,
      cause: by.cause,
      feedbackId: by.feedbackId,
    });
  }

  return doc;
});

/** Save changed media into the history. Edit requests and agent runs call this. */
export const recordMedia = Effect.fn("history.recordMedia")(function* (
  item: Item,
  captures: ReadonlyArray<MediaCapture>,
  by: Attribution,
) {
  const doc = yield* readHistory(item);
  const next = yield* capture(item, doc, captures, by);

  if (next !== doc) yield* writeHistory(item, next);
});

/** Copy a saved version over its media file. */
const putVersion = Effect.fnUntraced(function* (item: Item, doc: HistoryDoc, versionId: string) {
  const ws = yield* Workspace;
  const version = doc.versions.find((v) => v.id === versionId);

  if (version === undefined) {
    return yield* new NotFound({ message: `Version ${versionId} not found on ${item.id}` });
  }

  const path = `${item.dir}/${version.media}`;
  yield* ws.copy(`${item.dir}/${version.file}`, path);
  const { size, mtime } = yield* ws.stat(path);

  const next: HistoryDoc = {
    ...doc,
    heads: { ...doc.heads, [version.media]: { version: version.id, size, mtime } },
  };

  return next;
});

// ---------------------------------------------------------------------------------------------
// Item fields

interface DetailSource {
  readonly title?: string | undefined;
  readonly status?: ItemStatus | undefined;
  readonly hook?: string | null | undefined;
  readonly caption?: string | null | undefined;
  readonly notes?: string | null | undefined;
}

const valueOf = (source: DetailSource, field: DetailField) => source[field] ?? null;

function pickDetails(source: DetailSource, fields: ReadonlySet<DetailField>): DetailValues {
  const values: Types.Mutable<DetailValues> = {};

  if (fields.has("title") && source.title !== undefined) values.title = source.title;

  if (fields.has("status") && source.status !== undefined) values.status = source.status;

  if (fields.has("hook")) values.hook = source.hook ?? null;

  if (fields.has("caption")) values.caption = source.caption ?? null;

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
    caption: optionalField(values.caption, doc.caption),
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

  yield* writeHistory(item, pushEntry(yield* readHistory(item), entry));

  return item;
});

// ---------------------------------------------------------------------------------------------
// Undo and redo

type Direction = "undo" | "redo";

/** The verdict on a request that matches the side of it now in the file. */
const VERDICTS: Record<Direction, Partial<Record<MediaCause, Decision>>> = {
  undo: { edit: "restored", restore: "approved" },
  redo: { edit: "approved", restore: "restored" },
};

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

  const next = yield* putVersion(item, doc, direction === "undo" ? entry.from : entry.to);
  const decision = VERDICTS[direction][entry.cause];
  const { feedbackId } = entry;

  // Only the request about this media file gets a verdict; a request about the whole item can
  // change several files.
  const decided = (f: Feedback) => f.id === feedbackId && f.media === entry.media;

  if (feedbackId !== undefined && decision !== undefined) {
    const now = yield* nowIso;
    yield* mutateItem(item.id, (current) =>
      Effect.succeed({
        ...current,
        feedback: current.feedback.map((f) => (decided(f) ? withDecision(f, decision, now) : f)),
      }),
    );
  }

  return next;
});

/** Undo or redo until the first `target` entries are applied, saving each step as it lands. */
const travel = Effect.fnUntraced(function* (item: Item, start: HistoryDoc, target: number) {
  let doc = start;

  while (doc.cursor !== target) {
    const direction: Direction = doc.cursor > target ? "undo" : "redo";
    const index = direction === "undo" ? doc.cursor - 1 : doc.cursor;
    const entry = doc.entries[index];

    if (entry === undefined) break;
    const applied = yield* applyEntry(item, doc, entry, direction);
    doc = { ...applied, cursor: direction === "undo" ? index : index + 1 };
    yield* writeHistory(item, doc);
  }
});

/** The item's history, with tracked media changed outside a request saved as entries first. */
const synced = Effect.fnUntraced(function* (id: string) {
  const item = yield* getItem(id);
  const doc = yield* readHistory(item);
  const tracked = Object.keys(doc.heads).map((media) => ({ media }));
  const next = yield* capture(item, doc, tracked, { cause: "outside" });

  if (next !== doc) yield* writeHistory(item, next);

  return { item, doc: next };
});

export const undo = Effect.fn("history.undo")(function* (id: string) {
  const { item, doc } = yield* synced(id);

  if (doc.cursor === 0) return yield* new InvalidRequest({ message: "Nothing to undo" });
  yield* travel(item, doc, doc.cursor - 1);

  return yield* getItem(id);
});

export const redo = Effect.fn("history.redo")(function* (id: string) {
  const { item, doc } = yield* synced(id);

  if (doc.cursor >= doc.entries.length) {
    return yield* new InvalidRequest({ message: "Nothing to redo" });
  }

  yield* travel(item, doc, doc.cursor + 1);

  return yield* getItem(id);
});

/** Go to the state right after `entryId`, or to before the first change without one. */
export const goTo = Effect.fn("history.goTo")(function* (id: string, entryId?: string) {
  const { item, doc } = yield* synced(id);
  const index = entryId === undefined ? -1 : doc.entries.findIndex((e) => e.id === entryId);

  if (entryId !== undefined && index === -1) {
    return yield* new NotFound({ message: `History entry ${entryId} not found on ${id}` });
  }

  yield* travel(item, doc, index + 1);

  return yield* getItem(id);
});

/** Put a saved version back in its media file, as a change that can be undone. */
export const restoreVersion = Effect.fn("history.restoreVersion")(function* (
  id: string,
  versionId: string,
) {
  const { item, doc } = yield* synced(id);
  const version = doc.versions.find((v) => v.id === versionId);

  if (version === undefined) {
    return yield* new NotFound({ message: `Version ${versionId} not found on ${id}` });
  }

  const head = doc.heads[version.media];

  if (head?.version === versionId) return item;
  const placed = yield* putVersion(item, doc, versionId);

  const next =
    head === undefined
      ? placed
      : pushEntry(placed, {
          kind: "media",
          id: yield* shortId,
          at: yield* nowIso,
          media: version.media,
          from: head.version,
          to: versionId,
          cause: "version",
        });

  yield* writeHistory(item, next);

  return yield* getItem(id);
});
