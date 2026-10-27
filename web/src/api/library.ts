import { Schema } from "effect";

import { FormatDoc, LearnedDoc } from "../../../src/core/schema.ts";
import { q, request, send } from "./client.ts";

export { InputChoice, InputField, LearnedKind } from "../../../src/core/schema.ts";

export const Format = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  doc: FormatDoc,
  readme: Schema.optionalKey(Schema.String),
});

export type Format = typeof Format.Type;

const FormatProblemKind = Schema.Literals(["spec", "skill", "program", "file"]);

export type FormatProblemKind = typeof FormatProblemKind.Type;

export const FormatProblem = Schema.Struct({
  kind: FormatProblemKind,
  subject: Schema.String,
  message: Schema.String,
});

export type FormatProblem = typeof FormatProblem.Type;

/** A format folder, readable or not, and what stands between it and its first item. */
export const FormatStatus = Schema.Struct({
  id: Schema.String,
  format: Schema.optionalKey(Format),
  check: Schema.Struct({
    ready: Schema.Boolean,
    problems: Schema.Array(FormatProblem),
    /** Workspace-relative SKILL.md of each installed skill the format names. */
    skills: Schema.Record(Schema.String, Schema.String),
  }),
});

export type FormatStatus = typeof FormatStatus.Type;

/** Something the user taught the workspace about, with what a first look found. */
export const Learned = Schema.Struct({
  id: Schema.String,
  /** Workspace-relative folder; the doc's files are relative to it. */
  dir: Schema.String,
  doc: LearnedDoc,
  /** Whether no agent has read it into about.md yet. */
  unread: Schema.Boolean,
});

export type Learned = typeof Learned.Type;

export const LearnedList = Schema.Struct({
  learned: Schema.Array(Learned),
  /** about.md, once anything is learned or written there. */
  about: Schema.optionalKey(Schema.Struct({ path: Schema.String, text: Schema.String })),
});

export type LearnedList = typeof LearnedList.Type;

export const LearnResult = Schema.Struct({
  learned: Learned,
  warnings: Schema.Array(Schema.String),
});

export type LearnResult = typeof LearnResult.Type;

export const libraryApi = {
  learned: () => request(LearnedList, "/api/learned"),
  /** Learn a link, or a folder or file on this computer. */
  learn: (source: string) => send(LearnResult, "POST", "/api/learn", { source }),
  learnFile: (file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request(LearnResult, "/api/learn", { method: "POST", body: form });
  },
  /** Remove an entry and its section of about.md; answers with what is left. */
  forgetLearned: (id: string) => send(LearnedList, "POST", `/api/learned/forget${q(id)}`, {}),
  formats: () => request(Schema.Array(Format), "/api/formats"),
  formatStatuses: () => request(Schema.Array(FormatStatus), "/api/formats/status"),
};
