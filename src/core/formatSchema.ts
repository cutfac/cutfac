import { Schema } from "effect";

import { Aspect } from "./schema.ts";
import { describe, withDefault } from "./schemaFields.ts";

/** An Agent Skill the format's items are made with, looked up in the workspace's skill folders. */
export const FormatSkill = Schema.Struct({
  name: Schema.String.annotate(describe("the skill's folder name, as in .claude/skills/<name>")),
  source: Schema.optional(
    Schema.String.annotate(describe("where to install it from: a URL or an owner/repo")),
  ),
});

export type FormatSkill = typeof FormatSkill.Type;

/** One option of a choice input, such as a visual style. Paths are relative to the format folder. */
export const InputChoice = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  summary: Schema.optional(Schema.String),
  preview: Schema.optional(
    Schema.String.annotate(describe("an image or clip that shows the choice, format-relative")),
  ),
  files: Schema.Array(
    Schema.String.annotate(describe("format-relative files the agent reads for this choice")),
  ).pipe(withDefault([])),
});

export type InputChoice = typeof InputChoice.Type;

/** Something to decide when an item is made: one of `choices`, or free text without them. */
export const InputField = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.optional(Schema.String),
  choices: Schema.Array(InputChoice).pipe(withDefault([])),
  default: Schema.optional(Schema.String),
  required: Schema.Boolean.pipe(withDefault(false)),
});

export type InputField = typeof InputField.Type;

/** Where an imported format came from, for credit and rights. */
export const FormatSource = Schema.Struct({
  url: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  license: Schema.optional(Schema.String),
});

/** formats/<id>/format.yaml — a reusable recipe. */
export const FormatDoc = Schema.Struct({
  title: Schema.String,
  summary: Schema.String.pipe(withDefault("")),
  references: Schema.Array(Schema.String).pipe(withDefault([])),
  aspects: Schema.Array(Aspect).pipe(withDefault(["9x16"])),
  duration: Schema.optional(Schema.Struct({ min: Schema.Finite, max: Schema.Finite })),
  fps: Schema.optional(Schema.Finite),
  requireAudio: Schema.Boolean.pipe(withDefault(true)),
  hookRules: Schema.Array(Schema.String).pipe(withDefault([])),
  structure: Schema.Array(Schema.String).pipe(withDefault([])),
  render: Schema.optional(
    Schema.String.annotate(describe("command that renders one item, run from the workspace root")),
  ),
  checklist: Schema.Array(Schema.String).pipe(withDefault([])),
  source: Schema.optional(FormatSource),
  skills: Schema.Array(FormatSkill).pipe(withDefault([])),
  requires: Schema.Array(
    Schema.String.annotate(describe("a program the format runs, which must be on PATH")),
  ).pipe(withDefault([])),
  inputs: Schema.Array(InputField).pipe(withDefault([])),
  metadata: Schema.optional(
    Schema.Record(Schema.String, Schema.Unknown).annotate(
      describe("anything else the format's own tools keep; Cutfac leaves it alone"),
    ),
  ),
});

export type FormatDoc = typeof FormatDoc.Type;
