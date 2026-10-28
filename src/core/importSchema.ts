import { Schema } from "effect";

import { AgentName, AgentRun } from "./schema.ts";
import { Url, describe, withDefault } from "./schemaFields.ts";

export const IMPORT_TURN_KINDS = ["start", "reply", "allow"] as const;

/** One message from the user in an import, and the agent run that answered it. */
export const ImportTurn = Schema.Struct({
  id: Schema.String,
  at: Schema.String,
  kind: Schema.Literals(IMPORT_TURN_KINDS).annotate(
    describe("start: the link; reply: an answer to the agent; allow: consent to install and write"),
  ),
  body: Schema.String,
  attachments: Schema.optional(
    Schema.Array(Schema.String).annotate(
      describe("files under files/ in the import's folder that the user attached to the message"),
    ),
  ),
  run: Schema.optional(AgentRun),
});

export type ImportTurn = typeof ImportTurn.Type;

/** What was in the workspace when the user allowed installs, to tell what the import added. */
export const ImportBaseline = Schema.Struct({
  skills: Schema.Array(Schema.String),
  formats: Schema.Array(Schema.String),
});

export type ImportBaseline = typeof ImportBaseline.Type;

export const IMPORT_KINDS = ["link", "brief", "learn"] as const;

/**
 * .cutfac/imports/<id>.yaml: a template the user's agent brings in from a link, or makes for the
 * person the workspace brief describes.
 */
export const ImportDoc = Schema.Struct({
  kind: Schema.Literals(IMPORT_KINDS)
    .annotate(
      describe(
        "link: bring in the template a link shows; brief: make one from the workspace brief, starting from the link when there is one; learn: read what about.md hasn't yet and write it in, with no template",
      ),
    )
    .pipe(withDefault("link")),
  link: Schema.optional(Url),
  agent: AgentName,
  locale: Schema.optional(
    Schema.String.annotate(describe("language the agent writes to the user in")),
  ),
  allowed: Schema.Boolean.annotate(
    describe("the user allowed the agent to install and write; until then it only reads"),
  ).pipe(withDefault(false)),
  session: Schema.optional(
    Schema.String.annotate(describe("the agent's session, resumed each turn")),
  ),
  turns: Schema.Array(ImportTurn).pipe(withDefault([])),
  baseline: Schema.optional(ImportBaseline),
  skills: Schema.Array(Schema.String)
    .annotate(describe("skill folders that appeared after the user allowed installs"))
    .pipe(withDefault([])),
  formats: Schema.Array(Schema.String)
    .annotate(describe("formats that appeared after the user allowed installs"))
    .pipe(withDefault([])),
  closed: Schema.Boolean.pipe(withDefault(false)),
  created: Schema.String,
  updated: Schema.String,
});

export type ImportDoc = typeof ImportDoc.Type;
