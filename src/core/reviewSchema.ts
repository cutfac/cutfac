import { Schema } from "effect";

import { describe, withDefault } from "./schemaFields.ts";

/** A frame or a strip of frames at `t` seconds; `file` is relative to the review folder. */
export const ReviewShot = Schema.Struct({ t: Schema.Finite, file: Schema.String });

export type ReviewShot = typeof ReviewShot.Type;

/**
 * How far platform UI reaches in from each edge of a frame: the top and bottom as fractions of its
 * height, the sides of its width. Reviews made before the sides were shaded leave them out.
 */
export const SafeZone = Schema.Struct({
  top: Schema.Finite,
  bottom: Schema.Finite,
  left: Schema.Finite.pipe(withDefault(0)),
  right: Schema.Finite.pipe(withDefault(0)),
});

export type SafeZone = typeof SafeZone.Type;

/** items/<id>/review/<video name>/review.yaml: the frames last rendered to judge one video. */
export const ReviewDoc = Schema.Struct({
  file: Schema.String.annotate(describe("the reviewed video's name in the item")),
  at: Schema.String,
  /** Every frame on one image, left to right and top to bottom in time order. */
  sheet: Schema.optional(Schema.String),
  frames: Schema.Array(ReviewShot),
  /** Frames across each transition, where half-finished motion shows. */
  strips: Schema.Array(ReviewShot),
  /** The margins shaded on the frames and strips, where platform UI covers the video. */
  safeZone: Schema.optional(SafeZone),
  /** What could not be made, and what was left out. */
  notes: Schema.Array(Schema.String),
});

export type ReviewDoc = typeof ReviewDoc.Type;
