import { Effect } from "effect";

import { NotFound } from "./errors.ts";
import {
  type HistoryDoc,
  type MediaCause,
  type MediaHead,
  type MediaVersion,
} from "./historySchema.ts";
import { HISTORY_DIR, mutateHistory, pushEntry } from "./historyStore.ts";
import { type Item, shortId } from "./items.ts";
import { extension } from "./media.ts";
import { nowIso } from "./time.ts";
import { Workspace } from "./workspace.ts";

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
  /** The label of the request's version that was picked. */
  readonly variant?: string | undefined;
}

type Origin = Pick<MediaVersion, "cause" | "feedbackId" | "variant" | "source">;

/** A new version of `media` holding `file`, or a fresh copy of the file as it is now. */
const newVersion = Effect.fnUntraced(function* (
  item: Item,
  media: string,
  file: string | undefined,
  origin: Origin,
) {
  const ws = yield* Workspace;
  const id = yield* shortId;
  const saved = file ?? `${HISTORY_DIR}/${id}.${extension(media)}`;

  if (file === undefined) yield* ws.copy(`${item.dir}/${media}`, `${item.dir}/${saved}`);
  const { size } = yield* ws.stat(`${item.dir}/${saved}`);
  const version: MediaVersion = { id, media, file: saved, at: yield* nowIso, size, ...origin };

  return version;
});

export const versionOf = (doc: HistoryDoc, id: string | undefined) =>
  doc.versions.find((v) => v.id === id);

/** `doc` with `version` added, and its media file holding it when `head` is given. */
const withVersion = (doc: HistoryDoc, version: MediaVersion, head?: MediaHead): HistoryDoc => ({
  ...doc,
  versions: [...doc.versions, version],
  heads: head === undefined ? doc.heads : { ...doc.heads, [version.media]: head },
});

/**
 * The version a request's first change started from, which rolling the request back puts back:
 * its copy is the same size as `rolledBack`. Versions picked long after the request was made may
 * have started from a later one.
 */
function startOf(doc: HistoryDoc, rolledBack: MediaVersion) {
  const first = doc.entries.find(
    (e) =>
      e.kind === "media" &&
      e.media === rolledBack.media &&
      e.cause === "edit" &&
      e.feedbackId === rolledBack.feedbackId,
  );

  const start = first?.kind === "media" ? versionOf(doc, first.from) : undefined;

  return start?.size === rolledBack.size ? start.id : undefined;
}

/**
 * Save media files whose content is not a saved version yet. A tracked file that no longer
 * matches the version it should hold becomes a new version and a change from that version.
 */
export const capture = Effect.fnUntraced(function* (
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
      const first = yield* newVersion(item, media, base, { cause: "original" });
      doc = withVersion(doc, first);
      // An mtime no file has, so the file on disk is recorded as a change from the base.
      head = { version: first.id, size: first.size, mtime: -1 };
    }

    if (head === undefined && file === undefined && track !== true) continue;

    if (head !== undefined && head.size === size && head.mtime === mtime) continue;

    // The copy the file already holds, put in again: nothing changed.
    if (head !== undefined && file !== undefined && versionOf(doc, head.version)?.file === file) {
      doc = { ...doc, heads: { ...doc.heads, [media]: { ...head, size, mtime } } };
      continue;
    }

    // A file seen for the first time is the original, unless an agent made it.
    const origin: Origin =
      head === undefined && by.cause !== "edit"
        ? { cause: "original" }
        : { cause: by.cause, feedbackId: by.feedbackId, variant: by.variant };

    const made = yield* newVersion(item, media, file, origin);
    const version = made.cause === "restore" ? { ...made, source: startOf(doc, made) } : made;

    doc = withVersion(doc, version, { version: version.id, size, mtime });

    if (head === undefined) continue;

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
  yield* mutateHistory(item, (doc, save) =>
    Effect.gen(function* () {
      const next = yield* capture(item, doc, captures, by);

      if (next !== doc) yield* save(next);
    }),
  );
});

/** Copy a saved version over its media file. */
export const putVersion = Effect.fnUntraced(function* (
  item: Item,
  doc: HistoryDoc,
  versionId: string,
) {
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

/**
 * Put a media file back to the version it last held, if it changed since. A file with no saved
 * version did not exist before, so it is removed.
 */
export const putBack = Effect.fn("history.putBack")(function* (item: Item, media: string) {
  const ws = yield* Workspace;
  const path = `${item.dir}/${media}`;

  yield* mutateHistory(item, (doc, save) =>
    Effect.gen(function* () {
      const head = doc.heads[media];

      if (head === undefined) return yield* ws.remove(path);

      if (yield* ws.exists(path)) {
        const { size, mtime } = yield* ws.stat(path);

        if (head.size === size && head.mtime === mtime) return;
      }

      yield* save(yield* putVersion(item, doc, head.version));
    }),
  );
});
