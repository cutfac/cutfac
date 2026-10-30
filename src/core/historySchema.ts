import { Schema } from "effect";

import { StoredItemStatus } from "./schema.ts";
import { Count, describe, withDefault } from "./schemaFields.ts";

/** The version a media file holds, with the size and mtime it had once that version was in place. */
export const MediaHead = Schema.Struct({
  version: Schema.String,
  size: Count,
  mtime: Schema.Finite,
});

export type MediaHead = typeof MediaHead.Type;

export const MEDIA_CAUSES = ["edit", "restore", "version", "outside"] as const;

export type MediaCause = (typeof MEDIA_CAUSES)[number];

/** A change, or `original`: the file as it was when the history began to keep it. */
export const VERSION_CAUSES = ["original", ...MEDIA_CAUSES] as const;

export type VersionCause = (typeof VERSION_CAUSES)[number];

/**
 * A state a media file was put in. The history lists them in the order they happened, and never
 * drops one; several can share one saved copy.
 */
export const MediaVersion = Schema.Struct({
  id: Schema.String,
  media: Schema.String.annotate(describe("media file name this is a version of")),
  file: Schema.String.annotate(describe("item-relative copy of the file")),
  at: Schema.String,
  size: Count,
  cause: Schema.optional(Schema.Literals(VERSION_CAUSES)).annotate(
    describe("what put the file in this version; versions saved before it was kept have none"),
  ),
  feedbackId: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String).annotate(
    describe("label of the request's version that was picked"),
  ),
  source: Schema.optional(Schema.String).annotate(
    describe("the earlier version this one put back, which has the same content"),
  ),
});

export type MediaVersion = typeof MediaVersion.Type;

/** The first version with the content `version` has, following what each one put back. */
function rootVersion(versions: ReadonlyArray<MediaVersion>, version: MediaVersion): MediaVersion {
  const source = versions.find((v) => v.id === version.source);

  return source === undefined ? version : rootVersion(versions, source);
}

/** The version a change made, past versions that only put an earlier one back. */
export function madeBy(versions: ReadonlyArray<MediaVersion>, version: MediaVersion): MediaVersion {
  const source =
    version.cause === "version" ? versions.find((v) => v.id === version.source) : undefined;

  return source === undefined ? version : madeBy(versions, source);
}

/** Whether two versions hold the same content: one put the other back, or they share a copy. */
export const sameContent = (
  versions: ReadonlyArray<MediaVersion>,
  a: MediaVersion,
  b: MediaVersion,
) => rootVersion(versions, a).file === rootVersion(versions, b).file;

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

/** items/<id>/history/history.yaml: every version of the item's media, and its undo stack. */
export const HistoryDoc = Schema.Struct({
  cursor: Count.annotate(
    describe("entries before this index are applied; the ones after it can be redone"),
  ).pipe(withDefault(0)),
  entries: Schema.Array(HistoryEntry).pipe(withDefault([])),
  versions: Schema.Array(MediaVersion).pipe(withDefault([])),
  heads: Schema.Record(Schema.String, MediaHead).pipe(withDefault({})),
});

export type HistoryDoc = typeof HistoryDoc.Type;
