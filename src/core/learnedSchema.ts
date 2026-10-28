import { Schema } from "effect";

import { ItemSource } from "./schema.ts";
import { describe, withDefault } from "./schemaFields.ts";

export const Probe = Schema.Struct({
  duration: Schema.Finite,
  width: Schema.Finite,
  height: Schema.Finite,
  fps: Schema.Finite,
  hasAudio: Schema.Boolean,
});

/** preprocess.json beside a video: what deterministic preprocessing produced, folder-relative. */
export const PreprocessResult = Schema.Struct({
  cuts: Schema.Array(Schema.Finite),
  frames: Schema.Array(Schema.Struct({ file: Schema.String, t: Schema.Finite })),
  contactSheet: Schema.optional(Schema.String),
  audio: Schema.optional(Schema.String),
  transcript: Schema.optional(Schema.String),
  notes: Schema.Array(Schema.String),
});

export type PreprocessResult = typeof PreprocessResult.Type;

/** What the user taught the workspace about: a web page, an app's store page, a video, or a local folder or file. */
export const LEARNED_KINDS = ["page", "app", "video", "folder", "file"] as const;

export const LearnedKind = Schema.Literals(LEARNED_KINDS);

export type LearnedKind = typeof LearnedKind.Type;

/** learned/<id>/learned.yaml: what a first look at the source found. Files are entry-relative. */
export const LearnedDoc = Schema.Struct({
  kind: LearnedKind,
  title: Schema.String,
  description: Schema.String.pipe(withDefault("")),
  source: Schema.optional(ItemSource.annotate(describe("where it came from; none for an upload"))),
  site: Schema.optional(Schema.String.annotate(describe("the site, developer, or channel"))),
  icon: Schema.optional(Schema.String),
  images: Schema.Array(Schema.String).pipe(withDefault([])),
  video: Schema.optional(Schema.String),
  probe: Schema.optional(Probe),
  links: Schema.Array(Schema.String)
    .annotate(describe("related links the page points at, such as its store pages"))
    .pipe(withDefault([])),
  addedAt: Schema.String,
});

export type LearnedDoc = typeof LearnedDoc.Type;
