import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import type { CliEntry } from "../core/agents.ts";
import { InvalidRequest } from "../core/errors.ts";
import {
  ImportRuns,
  startImport,
  startTurn,
  stopAndCloseImport,
  stopImport,
} from "../core/importRun.ts";
import {
  type Import,
  type TurnInput,
  getImport,
  importFiles,
  listImports,
} from "../core/imports.ts";
import { IMPORT_KINDS } from "../core/importSchema.ts";
import { shortId } from "../core/items.ts";
import { listReferences } from "../core/references.ts";
import { AgentName } from "../core/schema.ts";
import { Workspace } from "../core/workspace.ts";
import { defaultAgent, ownLaunch } from "./agents.ts";
import { json, withId } from "./respond.ts";
import { runStream } from "./runStream.ts";
import { isMultipart, ReferencesForm, uploadsOf } from "./uploads.ts";

const COPY_INSTEAD = "copy the import prompt to your agent instead";

const NewImportBody = Schema.Struct({
  /** Optional only for a brief import, which may start from no reference. */
  link: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(IMPORT_KINDS)),
  agent: Schema.optional(AgentName),
  /** The board's language, for the agent to write in. */
  locale: Schema.optional(Schema.NonEmptyString),
});

/** A new import with files the user dropped, pasted or picked to go with the link. */
const NewImportForm = Schema.Struct({ ...NewImportBody.fields, ...ReferencesForm.fields });

/** A reply to the import's agent, or Allow with an optional note. */
const ImportReplyBody = Schema.Struct({
  body: Schema.optional(Schema.String),
  allow: Schema.optional(Schema.Boolean),
});

/** A reply to the import's agent with files; Allow carries none, so it stays JSON. */
const ImportReplyForm = Schema.Struct({ ...ReferencesForm.fields, body: Schema.String });

/** An import and whether an agent is on it, as the list of imports shows it. */
const importSummary = Effect.fn("server.importSummary")(function* (found: Import) {
  const runs = yield* ImportRuns;

  return { ...found, running: yield* runs.isRunning(found.id) };
});

/** An import as its chat shows it, with the files the user sent to it. */
const importDetail = Effect.fn("server.importDetail")(function* (found: Import) {
  const files = importFiles(found.id);

  return {
    ...(yield* importSummary(found)),
    dir: files.owner,
    references: yield* listReferences(files),
  };
});

/**
 * Start the user's agent on a link, or on the brief, and any files sent with it, read-only until
 * installs are allowed.
 */
const newImportRoute = (cli: CliEntry | undefined) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const request = yield* HttpServerRequest.HttpServerRequest;

    const form = isMultipart(request)
      ? yield* HttpServerRequest.schemaBodyMultipart(NewImportForm)
      : undefined;

    const body = form ?? (yield* HttpServerRequest.schemaBodyJson(NewImportBody));
    const uploads = form === undefined ? [] : yield* uploadsOf(form);
    const server = yield* ownLaunch(cli, COPY_INSTEAD);
    const agent = body.agent ?? defaultAgent(ws);
    const input = { link: body.link, kind: body.kind, agent, locale: body.locale };
    const started = yield* startImport(input, server, uploads);

    return yield* importDetail(started);
  });

/** Send the user's reply and any files with it, or their Allow, to the import's agent. */
const importReplyRoute = (cli: CliEntry | undefined) =>
  withId((id) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      const form = isMultipart(request)
        ? yield* HttpServerRequest.schemaBodyMultipart(ImportReplyForm)
        : undefined;

      const body: typeof ImportReplyBody.Type =
        form ?? (yield* HttpServerRequest.schemaBodyJson(ImportReplyBody));

      const uploads = form === undefined ? [] : yield* uploadsOf(form);
      const allow = body.allow === true;
      const text = body.body?.trim() ?? "";

      if (!allow && text === "")
        return yield* new InvalidRequest({ message: "Write a reply first" });

      const server = yield* ownLaunch(cli, COPY_INSTEAD);
      const turn: TurnInput = { id: yield* shortId, kind: allow ? "allow" : "reply", body: text };

      return yield* importDetail(yield* startTurn(id, turn, server, uploads));
    }),
  );

/** Stop the import's agent, if it is working. */
const stopImportRoute = withId((id) =>
  Effect.andThen(stopImport(id), Effect.flatMap(getImport(id), importDetail)),
);

/** Stop the import's agent, if it is working, and set the import aside. */
const closeImportRoute = withId((id) => Effect.flatMap(stopAndCloseImport(id), importDetail));

/** The chats in which the user's agent reads a link or the brief into the workspace. */
export const importRoutes = (cli: CliEntry | undefined) =>
  HttpRouter.addAll([
    json(
      "GET",
      "/api/imports",
      Effect.flatMap(listImports(), (imports) => Effect.forEach(imports, importSummary)),
    ),
    json("POST", "/api/imports", newImportRoute(cli)),
    json(
      "GET",
      "/api/import",
      withId((id) => Effect.flatMap(getImport(id), importDetail)),
    ),
    json("POST", "/api/import/reply", importReplyRoute(cli)),
    json("POST", "/api/import/stop", stopImportRoute),
    json("POST", "/api/import/close", closeImportRoute),
    runStream("/api/import/run", ImportRuns, getImport),
  ]);
