import { Schema } from "effect";

import { StoredItemStatus } from "./schema.ts";
import { Count, describe, withDefault } from "./schemaFields.ts";

/** A saved copy of one media file. */
export const MediaVersion = Schema.Struct({
  id: Schema.String,
  media: Schema.String.annotate(describe("media file name this is a version of")),
  file: Schema.String.annotate(describe("item-relative copy of the file")),
  at: Schema.String,
  size: Count,
});

export type MediaVersion = typeof MediaVersion.Type;

/** The version a media file holds, with the size and mtime it had once that version was in place. */
export const MediaHead = Schema.Struct({
  version: Schema.String,
  size: Count,
  mtime: Schema.Finite,
});

export type MediaHead = typeof MediaHead.Type;

export const MEDIA_CAUSES = ["edit", "restore", "version", "outside"] as const;

export type MediaCause = (typeof MEDIA_CAUSES)[number];

/** A media file went from one saved version to another. */
export const MediaChange = Schema.Struct({
  kind: Schema.Literal("media"),
  id: Schema.String,
  at: Schema.String,
  media: Schema.String,
  from: Schema.String,
  to: Schema.String,
  cause: Schema.Literals(MEDIA_CAUSES).annotate(
    describe(
      "edit: an agent worked on a request; restore: rolled back to before a request; version: picked from the history; outside: changed outside a request",
    ),
  ),
  feedbackId: Schema.optional(Schema.String),
});

export type MediaChange = typeof MediaChange.Type;

export const DETAIL_FIELDS = ["title", "status", "hook", "notes"] as const;

export type DetailField = (typeof DETAIL_FIELDS)[number];

/** Item fields an undo can put back. `null` is a field that was not set. */
export const DetailValues = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  status: Schema.optionalKey(StoredItemStatus),
  hook: Schema.optionalKey(Schema.NullOr(Schema.String)),
  notes: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export type DetailValues = typeof DetailValues.Type;

/** Item fields changed from the board or by an agent. */
export const DetailsChange = Schema.Struct({
  kind: Schema.Literal("details"),
  id: Schema.String,
  at: Schema.String,
  before: DetailValues,
  after: DetailValues,
});

export type DetailsChange = typeof DetailsChange.Type;

export const HistoryEntry = Schema.Union([MediaChange, DetailsChange]);

export type HistoryEntry = typeof HistoryEntry.Type;

/** items/<id>/history/history.yaml: saved media versions and the item's undo stack. */
export const HistoryDoc = Schema.Struct({
  cursor: Count.annotate(
    describe("entries before this index are applied; the ones after it can be redone"),
  ).pipe(withDefault(0)),
  entries: Schema.Array(HistoryEntry).pipe(withDefault([])),
  versions: Schema.Array(MediaVersion).pipe(withDefault([])),
  heads: Schema.Record(Schema.String, MediaHead).pipe(withDefault({})),
});

export type HistoryDoc = typeof HistoryDoc.Type;
