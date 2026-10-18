import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Option, Schema, Semaphore, Stream } from "effect";
import { Sse } from "effect/encoding";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
  Multipart,
} from "effect/http";

import { RunEvent, RunRegistry, type Runs, agentBin } from "../core/agentRun.ts";
import { type CliEntry, agentStatus, connectAgent, mcpLaunch } from "../core/agents.ts";
import {
  approveEdit,
  buildEditPrompt,
  cancelWaiting,
  pickVariant,
  requestEdit,
  resolveEdit,
  restoreBefore,
  rewordWaiting,
  waitingLine,
  waitingPick,
} from "../core/edits.ts";
import { Conflict, InvalidRequest } from "../core/errors.ts";
import { formatStatuses } from "../core/formatSpec.ts";
import { goTo, readHistory, redo, restoreVersion, undo, updateDetails } from "../core/history.ts";
import {
  ImportRuns,
  startImport,
  startTurn,
  stopAndCloseImport,
  stopImport,
} from "../core/importRun.ts";
import { type Import, type TurnInput, getImport, listImports } from "../core/imports.ts";
import {
  type Item,
  addFeedback,
  createItem,
  findFeedback,
  getItem,
  importMedia,
  listItems,
  openFeedback,
  shortId,
} from "../core/items.ts";
import { forget, learn, learnInputOf, listLearned, readAbout } from "../core/learn.ts";
import { getFormat, listFormats } from "../core/library.ts";
import { extension } from "../core/media.ts";
import { which } from "../core/process.ts";
import { listReviews } from "../core/review.ts";
import {
  AgentChoice,
  AgentName,
  type AgentPick,
  FeedbackInput,
  ItemPatch,
  ModelSettings,
} from "../core/schema.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace, type WorkspaceService } from "../core/workspace.ts";
import { requestGuard } from "./guard.ts";

export interface ServerOptions {
  /** The built board, served at `/`. Without it the server is API-only. */
  readonly webDir?: string | undefined;
  /** How agents should launch this CLI, for registering the MCP server from the board. */
  readonly cli?: CliEntry | undefined;
}

export interface ListenOptions extends ServerOptions {
  readonly port: number;
  readonly hostname: string;
}

/** Workspace files the board may load, by extension, with the type to serve them as. */
const SERVABLE = new Map([
  ["mp4", "video/mp4"],
  ["m4v", "video/mp4"],
  ["mov", "video/quicktime"],
  ["webm", "video/webm"],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["gif", "image/gif"],
  ["md", "text/markdown; charset=utf-8"],
  ["json", "application/json; charset=utf-8"],
  ["srt", "text/plain; charset=utf-8"],
  ["vtt", "text/vtt; charset=utf-8"],
  ["wav", "audio/wav"],
  ["mp3", "audio/mpeg"],
  ["m4a", "audio/mp4"],
]);

const FILES_PREFIX = "/files/";

/** Uploads are whole videos, far past Bun's 128 MB default. */
const MAX_UPLOAD_BYTES = 8 * 1024 ** 3;

const PING_EVERY = "25 seconds";

// ---------------------------------------------------------------------------------------------
// Responses

/** Every error a route can fail with carries a tag and a message for the board to show. */
interface Failure {
  readonly _tag: string;
  readonly message: string;
}

const STATUS_BY_TAG = new Map([
  ["NotFound", 404],
  ["InvalidRequest", 400],
  ["SchemaError", 400],
  ["MultipartError", 400],
  // Request bodies that are not JSON; route misses never reach the JSON routes.
  ["HttpServerError", 400],
  ["Conflict", 409],
  ["FetchFailed", 502],
]);

const failureResponse = (error: Failure) => {
  const status = STATUS_BY_TAG.get(error._tag) ?? 500;

  const response = HttpServerResponse.jsonUnsafe(
    { error: error.message || error._tag },
    { status },
  );

  return status >= 500 ? Effect.as(Effect.logError(error), response) : Effect.succeed(response);
};

/** Encode a route's result as JSON, and any failure as `{ error }` with a matching status. */
const respond = <A, E extends Failure, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flatMap((body) => HttpServerResponse.json(body)),
    Effect.catch(failureResponse),
  );

const notFound = HttpServerResponse.jsonUnsafe({ error: "No such API route" }, { status: 404 });

// ---------------------------------------------------------------------------------------------
// Request inputs

const IdQuery = Schema.Struct({ id: Schema.NonEmptyString });

const FeedbackQuery = Schema.Struct({
  id: Schema.NonEmptyString,
  feedbackId: Schema.NonEmptyString,
});

const NewItemBody = Schema.Struct({
  title: Schema.String,
  format: Schema.optional(Schema.NonEmptyString),
  hook: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const FeedbackRef = Schema.Struct({ feedbackId: Schema.NonEmptyString });

const PickBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  variantId: Schema.NonEmptyString,
});

const ResolveBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  resolution: Schema.optional(Schema.String),
});

/** Read beside the FeedbackInput fields of the same body. */
const EditVia = Schema.Struct({ agent: Schema.optional(AgentChoice), ...ModelSettings.fields });

const RunBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  agent: Schema.optional(AgentName),
  ...ModelSettings.fields,
});

/** One waiting request, or every one on the item. */
const CancelBody = Schema.Struct({ feedbackId: Schema.optional(Schema.NonEmptyString) });

const RewordBody = Schema.Struct({ feedbackId: Schema.NonEmptyString, body: Schema.String });

const ConnectBody = Schema.Struct({ agent: AgentName });

const NewImportBody = Schema.Struct({
  link: Schema.NonEmptyString,
  agent: Schema.optional(AgentName),
  /** The board's language, for the agent to write in. */
  locale: Schema.optional(Schema.NonEmptyString),
});

/** A reply to the import's agent, or Allow with an optional note. */
const ImportReplyBody = Schema.Struct({
  body: Schema.optional(Schema.String),
  allow: Schema.optional(Schema.Boolean),
});

const GoToBody = Schema.Struct({ entryId: Schema.optional(Schema.NonEmptyString) });

const VersionBody = Schema.Struct({ versionId: Schema.NonEmptyString });

const MediaForm = Schema.Struct({ file: Multipart.SingleFileSchema });

const LearnBody = Schema.Struct({ source: Schema.NonEmptyString });

const decodeEditVia = Schema.decodeUnknownEffect(EditVia);

const decodeFeedbackInput = Schema.decodeUnknownEffect(FeedbackInput);

const encodeRunEvent = Schema.encodeEffect(Schema.fromJsonString(RunEvent));

const queryId = Effect.map(HttpServerRequest.schemaSearchParams(IdQuery), (query) => query.id);

/** A route about the item or import named by `?id=`. */
const withId = <A, E, R>(f: (id: string) => Effect.Effect<A, E, R>) => Effect.flatMap(queryId, f);

const nonEmpty = (text: string | undefined) =>
  text === undefined || text.trim() === "" ? undefined : text.trim();

const isMultipart = (request: HttpServerRequest.HttpServerRequest) =>
  (request.headers["content-type"] ?? "").startsWith("multipart/form-data");

// ---------------------------------------------------------------------------------------------
// Items

/**
 * What the board shows for one item: the item, its markdown docs, its undo history, the agent's
 * last frame review of each video, and whether an agent is on it.
 */
const itemDetail = Effect.fn("server.itemDetail")(function* (item: Item) {
  const ws = yield* Workspace;
  const runs = yield* RunRegistry;

  const docs = yield* Effect.forEach(
    item.docs,
    (name) =>
      Effect.map(ws.readText(`${item.dir}/${name}`), (text): [string, string] => [name, text]),
    { concurrency: 4 },
  );

  return {
    ...item,
    docs: Object.fromEntries(docs),
    history: yield* readHistory(item),
    reviews: yield* listReviews(item),
    running: yield* runs.isRunning(item.id),
  };
});

const itemSummary = (item: Item) => ({
  id: item.id,
  dir: item.dir,
  title: item.doc.title,
  status: item.doc.status,
  format: item.doc.format,
  hook: item.doc.hook,
  openFeedback: item.doc.feedback.filter((f) => f.status === "open").length,
  media: item.media,
  updatedAt: item.updatedAt,
});

/** Everything learned, newest first, with about.md as agents read it. */
const learnedList = Effect.all(
  { learned: listLearned(), about: readAbout() },
  { concurrency: "unbounded" },
);

const workspaceInfo = Effect.gen(function* () {
  const ws = yield* Workspace;

  const [formats, feedback] = yield* Effect.all([listFormats(), openFeedback()], {
    concurrency: "unbounded",
  });

  return {
    name: ws.config.name,
    root: ws.root,
    config: ws.config,
    formats,
    openFeedback: feedback.length,
  };
});

// ---------------------------------------------------------------------------------------------
// Edit requests

interface Dispatch {
  readonly sent: AgentChoice;
  readonly warnings: ReadonlyArray<string>;
}

/** The agent a run uses when the request does not name one. */
const defaultAgent = (ws: WorkspaceService): AgentName =>
  ws.config.agent.default === "queue" ? "claude" : ws.config.agent.default;

const queuedInstead = (reason: string): Dispatch => ({
  sent: "queue",
  warnings: [`${reason}; the request is queued instead`],
});

const missingCli = (agent: AgentName) => `${agent} CLI not found on PATH`;

/** Start the agent on a recorded request, or leave it queued when the agent cannot start. */
const dispatch = Effect.fnUntraced(function* (itemId: string, feedbackId: string, pick: AgentPick) {
  const runs = yield* RunRegistry;

  if (Option.isNone(yield* which(pick.agent))) return queuedInstead(missingCli(pick.agent));

  return yield* runs.start({ itemId, feedbackId, ...pick }).pipe(
    Effect.as<Dispatch>({ sent: pick.agent, warnings: [] }),
    Effect.catchTag("Conflict", (error) => Effect.succeed(queuedInstead(error.message))),
  );
});

/**
 * Record a request and hand it to `via`: now, or once the item's run and the requests waiting
 * before it are done. Requests on an item run in the order they were made.
 */
const sendEdit = Effect.fnUntraced(function* (
  id: string,
  input: FeedbackInput,
  via: AgentChoice,
  settings: ModelSettings,
) {
  const runs = yield* RunRegistry;

  if (via === "queue") {
    const queued: Dispatch = { sent: "queue", warnings: [] };

    return { requested: yield* requestEdit(id, input), dispatched: queued };
  }

  const pick: AgentPick = { agent: via, ...settings };
  const busy = (yield* runs.isRunning(id)) || waitingLine((yield* getItem(id)).doc).length > 0;

  if (!busy) {
    const requested = yield* requestEdit(id, input);

    return { requested, dispatched: yield* dispatch(id, requested.feedback.id, pick) };
  }

  if (Option.isNone(yield* which(via))) {
    return { requested: yield* requestEdit(id, input), dispatched: queuedInstead(missingCli(via)) };
  }

  const waiting: Dispatch = { sent: via, warnings: [] };

  return { requested: yield* requestEdit(id, input, pick), dispatched: waiting };
});

/**
 * Record an edit request with its context files, then start the agent headlessly (streamed on
 * /api/item/run), line it up behind the item's run, or leave it queued for copy-paste.
 */
const editRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const runs = yield* RunRegistry;
  const id = yield* queryId;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const { agent, ...settings } = yield* decodeEditVia(body);
  const input = yield* decodeFeedbackInput(body);
  const via = agent ?? ws.config.agent.default;

  // Requests take turns here, so each sees whether the one before it started or lined up.
  return yield* runs.exclusive(
    id,
    Effect.gen(function* () {
      const { requested, dispatched } = yield* sendEdit(id, input, via, settings);

      return {
        item: yield* itemDetail(requested.item),
        feedbackId: requested.feedback.id,
        sent: dispatched.sent,
        warnings: [...requested.warnings, ...dispatched.warnings],
        prompt: yield* buildEditPrompt(requested.item, requested.feedback),
      };
    }),
  );
});

/** Send a queued request to an agent. */
const runRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const runs = yield* RunRegistry;
  const id = yield* queryId;
  const body = yield* HttpServerRequest.schemaBodyJson(RunBody);
  const { feedbackId, agent = defaultAgent(ws), ...settings } = body;
  yield* agentBin(agent);
  yield* findFeedback(yield* getItem(id), feedbackId);
  yield* runs.exclusive(id, runs.start({ itemId: id, feedbackId, agent, ...settings }));

  return { ok: true };
});

/** Start the item's waiting line again, after a run on it failed or was stopped. */
const continueRoute = withId((id) =>
  Effect.gen(function* () {
    const runs = yield* RunRegistry;

    return yield* runs.exclusive(
      id,
      Effect.gen(function* () {
        const first = waitingLine((yield* getItem(id)).doc)[0];

        if (first === undefined) {
          return yield* new InvalidRequest({ message: "No request is waiting on this item" });
        }

        yield* agentBin(first.waiting);
        yield* runs.start({ itemId: id, feedbackId: first.id, ...waitingPick(first) });

        return { ok: true };
      }),
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// Imports

/** An import and whether an agent is on it. */
const importDetail = Effect.fn("server.importDetail")(function* (found: Import) {
  const runs = yield* ImportRuns;

  return { ...found, running: yield* runs.isRunning(found.id) };
});

/** How agents launch this workspace's MCP server. `instead` says what to do when that is unknown. */
const ownLaunch = (options: ServerOptions, instead: string) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;

    if (options.cli === undefined) {
      return yield* new InvalidRequest({
        message: `This server does not know how it was launched; ${instead}`,
      });
    }

    return mcpLaunch(options.cli, ws.root);
  });

const COPY_INSTEAD = "copy the import prompt to your agent instead";

/** Start the user's agent on a link, read-only until the user allows installs. */
const newImportRoute = (options: ServerOptions) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const body = yield* HttpServerRequest.schemaBodyJson(NewImportBody);
    const server = yield* ownLaunch(options, COPY_INSTEAD);
    const agent = body.agent ?? defaultAgent(ws);
    const started = yield* startImport({ link: body.link, agent, locale: body.locale }, server);

    return yield* importDetail(started);
  });

/** Send the user's reply, or their Allow, to the import's agent in the same session. */
const importReplyRoute = (options: ServerOptions) =>
  withId((id) =>
    Effect.gen(function* () {
      const body = yield* HttpServerRequest.schemaBodyJson(ImportReplyBody);
      const allow = body.allow === true;
      const text = body.body?.trim() ?? "";

      if (!allow && text === "")
        return yield* new InvalidRequest({ message: "Write a reply first" });

      const server = yield* ownLaunch(options, COPY_INSTEAD);
      const turn: TurnInput = { id: yield* shortId, kind: allow ? "allow" : "reply", body: text };

      return yield* importDetail(yield* startTurn(id, turn, server));
    }),
  );

/** Stop the import's agent, if it is working. */
const stopImportRoute = withId((id) =>
  Effect.andThen(stopImport(id), Effect.flatMap(getImport(id), importDetail)),
);

/** Stop the import's agent, if it is working, and set the import aside. */
const closeImportRoute = withId((id) => Effect.flatMap(stopAndCloseImport(id), importDetail));

// ---------------------------------------------------------------------------------------------
// Server-sent events

const encoder = new TextEncoder();

const sseEvent = (event: string, data: string) =>
  encoder.encode(Sse.encoder.write(Sse.Event.make({ event, id: undefined, data })));

/** A ping now and then, so proxies and the browser keep an idle stream open. */
const keepAlive = Stream.map(Stream.tick(PING_EVERY), () => sseEvent("ping", ""));

const eventStream = <E>(events: Stream.Stream<Uint8Array, E>) =>
  HttpServerResponse.stream(Stream.merge(events, keepAlive), {
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache" },
  });

/**
 * The latest run on the queried key: a `run` event naming what it is about (an item's request, an
 * import's turn), its events so far, then live ones. `find` turns away keys that name nothing, so
 * a stray id cannot leave a channel behind.
 */
const runStreamRoute = <I, R, E, R2>(
  registry: Effect.Effect<Runs<I>, never, R>,
  find: (id: string) => Effect.Effect<unknown, E, R2>,
) =>
  Effect.gen(function* () {
    const runs = yield* registry;
    const id = yield* queryId;
    yield* find(id);

    // Subscribe inside the stream so the subscription lives exactly as long as the response.
    const events = Stream.unwrap(
      Effect.map(runs.subscribe(id), (subscription) => {
        const head = Option.match(subscription.subject, {
          onNone: () => Stream.empty,
          onSome: (subject) => Stream.make(sseEvent("run", subject)),
        });

        const body = Stream.mapEffect(subscription.events, (event) =>
          Effect.map(encodeRunEvent(event), (data) => sseEvent("agent", data)),
        );

        return Stream.concat(head, body);
      }),
    );

    return eventStream(events);
  });

/** Workspace paths that changed on disk, so agent writes appear without a reload. */
const changesRoute = Effect.map(Workspace, (ws) =>
  eventStream(Stream.map(ws.changes, (path) => sseEvent("change", path))),
);

// ---------------------------------------------------------------------------------------------
// Workspace files

export type ByteRange =
  | { readonly kind: "whole" }
  | { readonly kind: "slice"; readonly start: number; readonly end: number }
  | { readonly kind: "unsatisfiable" };

/**
 * One `Range: bytes=…` header against a file of `size` bytes. `end` is inclusive. Headers this
 * does not understand, such as multiple ranges, get the whole file, as HTTP allows.
 */
export function parseRange(header: string | undefined, size: number): ByteRange {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  const from = match?.[1] ?? "";
  const to = match?.[2] ?? "";

  if (from === "" && to === "") return { kind: "whole" };

  const start = from === "" ? Math.max(0, size - Number(to)) : Number(from);
  const end = from === "" || to === "" ? size - 1 : Math.min(Number(to), size - 1);

  if (start > end || (from === "" && Number(to) === 0)) return { kind: "unsatisfiable" };

  return { kind: "slice", start, end };
}

const decodePath = (encoded: string) =>
  Effect.try({
    try: () => decodeURIComponent(encoded),
    catch: () => new InvalidRequest({ message: "Malformed file path" }),
  });

/** A workspace file, with byte ranges so the board can scrub video. */
const fileRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const request = yield* HttpServerRequest.HttpServerRequest;
  const url = HttpServerRequest.toURL(request);

  const pathname = Option.match(url, {
    onNone: () => request.url,
    onSome: (value) => value.pathname,
  });

  const rel = yield* decodePath(pathname.slice(FILES_PREFIX.length));
  const contentType = SERVABLE.get(extension(rel));

  if (contentType === undefined) return HttpServerResponse.text("Not servable", { status: 403 });

  const resolved = yield* Effect.option(ws.abs(rel));

  if (Option.isNone(resolved))
    return HttpServerResponse.text("Outside the workspace", { status: 403 });

  if (!(yield* ws.exists(rel))) return HttpServerResponse.text("Not found", { status: 404 });

  const { size } = yield* ws.stat(rel);
  const range = parseRange(request.headers["range"], size);
  const headers = { "accept-ranges": "bytes", "cache-control": "no-cache" };

  switch (range.kind) {
    case "whole":
      return yield* HttpServerResponse.file(resolved.value, { contentType, headers });
    case "slice":
      return yield* HttpServerResponse.file(resolved.value, {
        contentType,
        status: 206,
        offset: range.start,
        bytesToRead: range.end - range.start + 1,
        headers: { ...headers, "content-range": `bytes ${range.start}-${range.end}/${size}` },
      });
    case "unsatisfiable":
      return HttpServerResponse.empty({
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
  }
});

// ---------------------------------------------------------------------------------------------
// Routes

const json = <A, E extends Failure, R>(
  method: "GET" | "POST" | "PATCH",
  path: HttpRouter.PathInput,
  handler: Effect.Effect<A, E, R>,
) => HttpRouter.route(method, path, respond(handler));

/** The board's API and the workspace files it loads. */
const apiRoutes = (options: ServerOptions) =>
  HttpRouter.addAll([
    json("GET", "/api/workspace", workspaceInfo),
    json("GET", "/api/agents", agentStatus()),
    json(
      "POST",
      "/api/agents/connect",
      Effect.gen(function* () {
        const { agent } = yield* HttpServerRequest.schemaBodyJson(ConnectBody);
        const server = yield* ownLaunch(options, "run `cutfac agent-setup --connect` instead");

        return yield* connectAgent(agent, server);
      }),
    ),

    json(
      "GET",
      "/api/items",
      Effect.map(listItems(), (items) => items.map(itemSummary)),
    ),
    json(
      "POST",
      "/api/items",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(NewItemBody), (body) =>
        Effect.flatMap(createItem(body), itemDetail),
      ),
    ),
    json(
      "GET",
      "/api/item",
      withId((id) => Effect.flatMap(getItem(id), itemDetail)),
    ),
    json(
      "POST",
      "/api/item/media",
      withId((id) =>
        Effect.gen(function* () {
          const { file } = yield* HttpServerRequest.schemaBodyMultipart(MediaForm);
          const { item } = yield* importMedia(id, file.path, file.name);

          return yield* itemDetail(item);
        }),
      ),
    ),
    json(
      "POST",
      "/api/item/feedback",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(FeedbackInput), (input) =>
          Effect.flatMap(addFeedback(id, input), (added) => itemDetail(added.item)),
        ),
      ),
    ),
    json(
      "POST",
      "/api/item/feedback/resolve",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(ResolveBody), (body) =>
          Effect.flatMap(
            resolveEdit(id, body.feedbackId, nonEmpty(body.resolution) ?? "Resolved in the web UI"),
            itemDetail,
          ),
        ),
      ),
    ),
    json("POST", "/api/item/edit", editRoute),
    json("POST", "/api/item/edit/run", runRoute),
    json("POST", "/api/item/edit/continue", continueRoute),
    json(
      "POST",
      "/api/item/edit/cancel",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(CancelBody), (body) =>
          Effect.flatMap(cancelWaiting(id, body.feedbackId), itemDetail),
        ),
      ),
    ),
    json(
      "POST",
      "/api/item/edit/reword",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(RewordBody), (body) =>
          Effect.flatMap(rewordWaiting(id, body.feedbackId, body.body), itemDetail),
        ),
      ),
    ),
    json(
      "POST",
      "/api/item/edit/stop",
      withId((id) =>
        Effect.map(
          Effect.flatMap(RunRegistry, (runs) => runs.stop(id)),
          (stopped) => ({ ok: true, stopped }),
        ),
      ),
    ),
    json(
      "GET",
      "/api/item/edit/prompt",
      Effect.gen(function* () {
        const query = yield* HttpServerRequest.schemaSearchParams(FeedbackQuery);
        const item = yield* getItem(query.id);
        const feedback = yield* findFeedback(item, query.feedbackId);

        return { prompt: yield* buildEditPrompt(item, feedback) };
      }),
    ),
    json(
      "POST",
      "/api/item/edit/approve",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(FeedbackRef), (body) =>
          Effect.flatMap(approveEdit(id, body.feedbackId), itemDetail),
        ),
      ),
    ),
    json(
      "POST",
      "/api/item/edit/pick",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(PickBody), (body) =>
          Effect.flatMap(pickVariant(id, body.feedbackId, body.variantId), itemDetail),
        ),
      ),
    ),
    json(
      "POST",
      "/api/item/edit/restore",
      withId((id) =>
        Effect.flatMap(HttpServerRequest.schemaBodyJson(FeedbackRef), (body) =>
          Effect.flatMap(restoreBefore(id, body.feedbackId), itemDetail),
        ),
      ),
    ),
    json("GET", "/api/item/verify", withId(verifyItem)),
    HttpRouter.route(
      "GET",
      "/api/item/run",
      Effect.catch(runStreamRoute(RunRegistry, getItem), failureResponse),
    ),

    json(
      "GET",
      "/api/imports",
      Effect.flatMap(listImports(), (imports) => Effect.forEach(imports, importDetail)),
    ),
    json("POST", "/api/imports", newImportRoute(options)),
    json(
      "GET",
      "/api/import",
      withId((id) => Effect.flatMap(getImport(id), importDetail)),
    ),
    json("POST", "/api/import/reply", importReplyRoute(options)),
    json("POST", "/api/import/stop", stopImportRoute),
    json("POST", "/api/import/close", closeImportRoute),
    HttpRouter.route(
      "GET",
      "/api/import/run",
      Effect.catch(runStreamRoute(ImportRuns, getImport), failureResponse),
    ),

    json("GET", "/api/feedback", openFeedback()),
    json("GET", "/api/learned", learnedList),
    json(
      "POST",
      "/api/learn",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        if (isMultipart(request)) {
          const { file } = yield* HttpServerRequest.schemaBodyMultipart(MediaForm);

          return yield* learn({ file: file.path, name: file.name });
        }

        const body = yield* HttpServerRequest.schemaBodyJson(LearnBody);

        return yield* learn(learnInputOf(body.source));
      }),
    ),
    json("POST", "/api/learned/forget", Effect.andThen(withId(forget), learnedList)),
    json("GET", "/api/formats", listFormats()),
    json("GET", "/api/formats/status", formatStatuses()),
    json("GET", "/api/format", withId(getFormat)),
    HttpRouter.route("GET", "/api/events", changesRoute),

    HttpRouter.route("GET", `${FILES_PREFIX}*`, Effect.catch(fileRoute, failureResponse)),
  ]);

/** The built board, with unknown paths falling back to its index for client-side routing. */
const boardRoutes = (webDir: string) =>
  HttpRouter.addAll(
    Effect.map(HttpStaticServer.make({ root: webDir, spa: true }), (handler) => [
      HttpRouter.route("GET", "*", Effect.catch(handler, HttpServerRespondable.toResponse)),
    ]),
  );

/**
 * Changes that go through the item's undo history. They run one at a time, and undo waits until
 * no agent is working on the item, since the agent may be editing the same files.
 */
const historyRoutes = HttpRouter.addAll(
  Effect.map(Semaphore.make(1), (lock) => {
    const recorded = <E, R>(change: (id: string) => Effect.Effect<Item, E, R>) =>
      withId((id) => lock.withPermits(1)(Effect.flatMap(change(id), itemDetail)));

    const travel = <E, R>(change: (id: string) => Effect.Effect<Item, E, R>) =>
      recorded((id) =>
        Effect.gen(function* () {
          const runs = yield* RunRegistry;

          if (yield* runs.isRunning(id)) {
            return yield* new Conflict({
              message: "An agent is working on this item; wait for it or stop it first",
            });
          }

          return yield* change(id);
        }),
      );

    return [
      json(
        "PATCH",
        "/api/item",
        recorded((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(ItemPatch), (patch) =>
            updateDetails(id, patch),
          ),
        ),
      ),
      json("POST", "/api/item/history/undo", travel(undo)),
      json("POST", "/api/item/history/redo", travel(redo)),
      json(
        "POST",
        "/api/item/history/goto",
        travel((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(GoToBody), (body) =>
            goTo(id, body.entryId),
          ),
        ),
      ),
      json(
        "POST",
        "/api/item/history/version",
        travel((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(VersionBody), (body) =>
            restoreVersion(id, body.versionId),
          ),
        ),
      ),
    ];
  }),
);

/**
 * Routes that need nothing are added on their own: in a route list they would widen the list's
 * error and requirement types to `any`.
 */
const staticRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/api/health", HttpServerResponse.jsonUnsafe({ ok: true })),
  HttpRouter.add("*", "/api/*", notFound),
);

/** Every route of the board's API, the workspace files, and the board itself. */
export const routes = (options: ServerOptions) =>
  options.webDir === undefined
    ? Layer.mergeAll(staticRoutes, apiRoutes(options), historyRoutes)
    : Layer.mergeAll(staticRoutes, apiRoutes(options), historyRoutes, boardRoutes(options.webDir));

/** The board and its API on a local port. Needs the workspace; brings everything else. */
export const serverLayer = (options: ListenOptions) =>
  HttpRouter.serve(Layer.merge(routes(options), requestGuard(options.hostname)), {
    disableLogger: true,
  }).pipe(
    Layer.provide(Layer.mergeAll(RunRegistry.layer(options.cli), ImportRuns.layer)),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(
      BunHttpServer.layer({
        port: options.port,
        hostname: options.hostname,
        maxRequestBodySize: MAX_UPLOAD_BYTES,
        // Uploads, ffmpeg-backed requests, and event streams all outlast Bun's 10 s default.
        idleTimeout: 0,
      }),
    ),
  );
