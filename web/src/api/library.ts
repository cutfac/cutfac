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

export const FormatStatus = Schema.Struct({
  id: Schema.String,
  format: Schema.optionalKey(Format),
  check: Schema.Struct({
    ready: Schema.Boolean,
    problems: Schema.Array(FormatProblem),
    skills: Schema.Record(Schema.String, Schema.String),
  }),
});

export type FormatStatus = typeof FormatStatus.Type;

export const Learned = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  doc: LearnedDoc,
  unread: Schema.Boolean,
});

export type Learned = typeof Learned.Type;

export const LearnedList = Schema.Struct({
  learned: Schema.Array(Learned),
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
  learn: (source: string) => send(LearnResult, "POST", "/api/learn", { source }),
  learnFile: (file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request(LearnResult, "/api/learn", { method: "POST", body: form });
  },
  forgetLearned: (id: string) => send(LearnedList, "POST", `/api/learned/forget${q(id)}`, {}),
  formats: () => request(Schema.Array(Format), "/api/formats"),
  formatStatuses: () => request(Schema.Array(FormatStatus), "/api/formats/status"),
};
