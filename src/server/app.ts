import { BunHttpServer } from "@effect/platform-bun";
import { Effect, Layer, Option, Schema, Semaphore, Stream } from "effect";
import {
  FetchHttpClient,
  HttpRouter,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
  HttpStaticServer,
  Multipart,
} from "effect/http";

import { agentBin } from "../core/agentCommand.ts";
import { RunEvent } from "../core/agentParse.ts";
import {
  PermissionChoice,
  agentPermissions,
  setAgentPermissions,
} from "../core/agentPermissions.ts";
import { RunRegistry } from "../core/agentRun.ts";
import { type CliEntry, agentStatus, connectAgent, mcpLaunch } from "../core/agents.ts";
import type { Approval } from "../core/approval.ts";
import {
  approveEdit,
  awaitsDecision,
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
import { errorCount, recentLogs } from "../core/feedbackLogs.ts";
import { formatStatuses } from "../core/formatSpec.ts";
import { goTo, readHistory, redo, restoreVersion, undo, updateDetails } from "../core/history.ts";
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
import {
  type Item,
  addFeedback,
  findFeedback,
  getItem,
  importMedia,
  listItems,
  openFeedback,
  shortId,
} from "../core/items.ts";
import { forget, learn, learnInputOf, listLearned, readAbout } from "../core/learn.ts";
import { getFormat, listFormats } from "../core/library.ts";
import { addLinkedVideo } from "../core/linkedVideos.ts";
import {
  McpDecision,
  McpPluginDecision,
  decideMcpPlugin,
  decideMcpServer,
  mcpServersStatus,
} from "../core/mcpApprovals.ts";
import { extension } from "../core/media.ts";
import { which } from "../core/process.ts";
import {
  type ReferenceUpload,
  addReferences,
  itemReferences,
  listReferences,
  removeReference,
} from "../core/references.ts";
import { readRender } from "../core/render.ts";
import { listReviews } from "../core/review.ts";
import type { Runs } from "../core/runRegistry.ts";
import {
  AgentChoice,
  AgentName,
  type AgentPick,
  FeedbackInput,
  IMPORT_KINDS,
  ItemPatch,
  ModelSettings,
} from "../core/schema.ts";
import { sendTeamFeedback } from "../core/teamFeedback.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace, type WorkspaceService } from "../core/workspace.ts";
import { requireTrust, trustProblem, trustStatus, trustWorkspace } from "../core/workspaceTrust.ts";
import {
  type ReportSettings,
  feedbackInstallId,
  reportSettings,
  resetInstallId,
  setReportChoices,
} from "../errorReports.ts";
import { createCountedItem, planStatus } from "../plan.ts";
import { trackUsage } from "../usageStats.ts";
import { approvalRoutes } from "./approvals.ts";
import { briefRoutes } from "./brief.ts";
import { requestGuard } from "./guard.ts";
import { renderChanges, renderRoutes } from "./render.ts";
import { failureResponse, json, queryId, withId } from "./respond.ts";
import { eventStream, sseEvent } from "./sse.ts";

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

// ---------------------------------------------------------------------------------------------
// Responses

const notFound = HttpServerResponse.jsonUnsafe({ error: "No such API route" }, { status: 404 });

// ---------------------------------------------------------------------------------------------
// Request inputs

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

const TrustBody = Schema.Struct({ fingerprint: Schema.NonEmptyString });

const NewImportBody = Schema.Struct({
  /** Optional only for a brief import, which may start from no reference. */
  link: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(IMPORT_KINDS)),
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

/** Dropped files and, in the same order, each one's path in the drop: `logo.png`, `photos/a.jpg`. */
const ReferencesForm = Schema.Struct({
  files: Multipart.FilesSchema,
  paths: Schema.optional(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
});

/** A new import with files the user dropped, pasted or picked to go with the link. */
const NewImportForm = Schema.Struct({ ...NewImportBody.fields, ...ReferencesForm.fields });

/** A reply to the import's agent with files; Allow carries none, so it stays JSON. */
const ImportReplyForm = Schema.Struct({ ...ReferencesForm.fields, body: Schema.String });

const ReferenceBody = Schema.Struct({ path: Schema.NonEmptyString });

/** A video link to download into an item's references. */
const LinkBody = Schema.Struct({ url: Schema.NonEmptyString });

const LearnBody = Schema.Struct({ source: Schema.NonEmptyString });

/** Feedback for the Cutfac team, from the board's dialog or a `/feedback` message. */
const TeamFeedbackBody = Schema.Struct({
  message: Schema.String,
  email: Schema.optional(Schema.String),
  source: Schema.Literals(["board", "slash"]),
  platform: Schema.optional(Schema.String),
  locale: Schema.optional(Schema.String),
  agent: Schema.optional(Schema.String),
  logs: Schema.optional(Schema.Boolean),
});

/** What the person chose to send; a choice left out stays as it was. */
const ReportChoicesBody = Schema.Struct({
  errorReports: Schema.optionalKey(Schema.Boolean),
  usageStats: Schema.optionalKey(Schema.Boolean),
});

/** How the desktop app's first launch went, which the board hands on once the workspace is up. */
const OnboardingFinishedBody = Schema.Struct({
  screen_recording: Schema.Boolean,
  accessibility: Schema.Boolean,
});

/** The error report and usage statistics settings as the board reads them. */
const reportView = ({ available, errorReports, usageStats, installId }: ReportSettings) => ({
  available,
  errorReports: Option.getOrNull(errorReports),
  usageStats: Option.getOrNull(usageStats),
  installId: Option.getOrNull(installId),
});

const decodeEditVia = Schema.decodeUnknownEffect(EditVia);

const decodeFeedbackInput = Schema.decodeUnknownEffect(FeedbackInput);

const encodeRunEvent = Schema.encodeEffect(Schema.fromJsonString(RunEvent));

const nonEmpty = (text: string | undefined) =>
  text === undefined || text.trim() === "" ? undefined : text.trim();

const isMultipart = (request: HttpServerRequest.HttpServerRequest) =>
  (request.headers["content-type"] ?? "").startsWith("multipart/form-data");

/** What was dropped, each file with its path in the drop: its name unless the form gave paths. */
const uploadsOf = Effect.fnUntraced(function* (form: typeof ReferencesForm.Type) {
  const given =
    form.paths === undefined ? form.files.map((file) => file.name) : [form.paths].flat();

  if (given.length !== form.files.length) {
    return yield* new InvalidRequest({ message: "Send one path for each file" });
  }

  return form.files.map((file, index): ReferenceUpload => ({
    source: file.path,
    path: given[index] ?? "",
  }));
});

// ---------------------------------------------------------------------------------------------
// Items

/**
 * What the board shows for one item: the item, its markdown docs, its undo history, the agent's
 * last frame review of each video, its reference files, and whether an agent is on it.
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
    references: yield* listReferences(itemReferences(item)),
    running: yield* runs.isRunning(item.id),
  };
});

/** Files dropped, pasted or picked on the board, kept as the item's references. */
const addReferencesRoute = Effect.fn("server.addReferences")(function* (id: string) {
  const uploads = yield* uploadsOf(yield* HttpServerRequest.schemaBodyMultipart(ReferencesForm));
  const added = yield* addReferences(itemReferences(yield* getItem(id)), uploads);

  return { item: yield* itemDetail(yield* getItem(id)), added };
});

/** How many of the run's asks wait on the user to let it use a tool, and how many to answer it. */
const asked = (pending: ReadonlyArray<Approval>) => {
  const questions = pending.filter((approval) => approval.kind === "question").length;

  return { approvals: pending.length - questions, questions };
};

/**
 * What the gallery shows of an item: its requests still open or waiting for the user's decision,
 * whether an agent works on it and how many of its asks wait for an answer, and its render while
 * it goes on or after it failed, so a tile can say what waits for the user and what is under way.
 */
const itemSummary = Effect.fn("server.itemSummary")(function* (item: Item) {
  const runs = yield* RunRegistry;
  const render = yield* readRender(item.id);
  const { feedback } = item.doc;

  return {
    id: item.id,
    dir: item.dir,
    title: item.doc.title,
    status: item.doc.status,
    format: item.doc.format,
    hook: item.doc.hook,
    openFeedback: feedback.filter((f) => f.status === "open").length,
    requests: feedback.filter((f) => f.status === "open" || awaitsDecision(f)),
    running: yield* runs.isRunning(item.id),
    ...asked(yield* runs.pending(item.id)),
    render: Option.getOrUndefined(
      Option.filter(render, ({ status }) => status === "running" || status === "failed"),
    ),
    media: item.media,
    updatedAt: item.updatedAt,
  };
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

/** Why `agent` can't start in this workspace now, if it can't. */
const cannotStart = Effect.fnUntraced(function* (agent: AgentName) {
  if (Option.isNone(yield* which(agent))) return `${agent} CLI not found on PATH`;

  return yield* trustProblem(agent);
});

/** Start the agent on a recorded request, or leave it queued when the agent cannot start. */
const dispatch = Effect.fnUntraced(function* (itemId: string, feedbackId: string, pick: AgentPick) {
  const runs = yield* RunRegistry;
  const problem = yield* cannotStart(pick.agent);

  if (problem !== undefined) return queuedInstead(problem);

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

  const problem = yield* cannotStart(via);

  if (problem !== undefined) {
    return { requested: yield* requestEdit(id, input), dispatched: queuedInstead(problem) };
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

      yield* trackUsage("edit_requested", { versions: input.variants ?? 1 });

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
  yield* requireTrust(agent);
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
        yield* requireTrust(first.waiting);
        yield* runs.start({ itemId: id, feedbackId: first.id, ...waitingPick(first) });

        return { ok: true };
      }),
    );
  }),
);

// ---------------------------------------------------------------------------------------------
// Imports

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

/**
 * Start the user's agent on a link, or on the brief, and any files sent with it, read-only until
 * installs are allowed.
 */
const newImportRoute = (options: ServerOptions) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const request = yield* HttpServerRequest.HttpServerRequest;

    const form = isMultipart(request)
      ? yield* HttpServerRequest.schemaBodyMultipart(NewImportForm)
      : undefined;

    const body = form ?? (yield* HttpServerRequest.schemaBodyJson(NewImportBody));
    const uploads = form === undefined ? [] : yield* uploadsOf(form);
    const server = yield* ownLaunch(options, COPY_INSTEAD);
    const agent = body.agent ?? defaultAgent(ws);
    const input = { link: body.link, kind: body.kind, agent, locale: body.locale };
    const started = yield* startImport(input, server, uploads);

    return yield* importDetail(started);
  });

/** Send the user's reply and any files with it, or their Allow, to the import's agent. */
const importReplyRoute = (options: ServerOptions) =>
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

      const server = yield* ownLaunch(options, COPY_INSTEAD);
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

// ---------------------------------------------------------------------------------------------
// Server-sent events

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

/**
 * Workspace paths that changed on disk, renders starting or ending, and items whose agent asks the
 * board or has its asking settled, so agent work appears without a reload.
 */
const changesRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const renders = yield* renderChanges;
  const runs = yield* RunRegistry;

  return eventStream(
    Stream.mergeAll(
      [
        Stream.map(ws.changes, (path) => sseEvent("change", path)),
        renders,
        Stream.map(runs.asks, (id) => sseEvent("change", id)),
      ],
      { concurrency: "unbounded" },
    ),
  );
});

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

/** The board's API and the workspace files it loads. */
const apiRoutes = (options: ServerOptions) =>
  HttpRouter.addAll([
    json("GET", "/api/workspace", workspaceInfo),
    json("GET", "/api/plan", planStatus()),
    json("GET", "/api/agents", agentStatus()),
    json("GET", "/api/trust", trustStatus()),
    json(
      "POST",
      "/api/trust",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(TrustBody), (body) =>
        trustWorkspace(body.fingerprint),
      ),
    ),
    json("GET", "/api/agent-permissions", agentPermissions()),
    json(
      "POST",
      "/api/agent-permissions",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(PermissionChoice), setAgentPermissions),
    ),
    json("GET", "/api/mcp-servers", mcpServersStatus()),
    json(
      "POST",
      "/api/mcp-servers",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(McpDecision), decideMcpServer),
    ),
    json(
      "POST",
      "/api/mcp-plugins",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(McpPluginDecision), decideMcpPlugin),
    ),
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
      Effect.flatMap(listItems(), (items) =>
        Effect.forEach(items, itemSummary, { concurrency: "unbounded" }),
      ),
    ),
    json(
      "POST",
      "/api/items",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(NewItemBody), (body) =>
        createCountedItem(body).pipe(
          Effect.tap(() => trackUsage("video_created", { template: body.format !== undefined })),
          Effect.flatMap(itemDetail),
        ),
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
    json("POST", "/api/item/references", withId(addReferencesRoute)),
    json(
      "POST",
      "/api/item/references/link",
      withId((id) =>
        Effect.gen(function* () {
          const { url } = yield* HttpServerRequest.schemaBodyJson(LinkBody);
          const added = yield* addLinkedVideo(itemReferences(yield* getItem(id)), url);

          return { item: yield* itemDetail(yield* getItem(id)), added: [added] };
        }),
      ),
    ),
    json(
      "POST",
      "/api/item/references/remove",
      withId((id) =>
        Effect.gen(function* () {
          const { path } = yield* HttpServerRequest.schemaBodyJson(ReferenceBody);
          yield* removeReference(yield* getItem(id), path);

          return yield* itemDetail(yield* getItem(id));
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
          pickVariant(id, body.feedbackId, body.variantId).pipe(
            Effect.tap(() => trackUsage("take_kept")),
            Effect.flatMap(itemDetail),
          ),
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
      Effect.flatMap(listImports(), (imports) => Effect.forEach(imports, importSummary)),
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
    json(
      "POST",
      "/api/team-feedback",
      Effect.gen(function* () {
        const ws = yield* Workspace;
        const { logs, ...body } = yield* HttpServerRequest.schemaBodyJson(TeamFeedbackBody);

        yield* sendTeamFeedback({
          ...body,
          withLogs: logs,
          agent: body.agent ?? defaultAgent(ws),
          install: Option.getOrUndefined(yield* feedbackInstallId(logs)),
        });

        return { ok: true };
      }),
    ),
    json(
      "GET",
      "/api/team-feedback/logs",
      Effect.map(recentLogs, (logs) => ({
        logs: Option.getOrNull(logs),
        errors: Option.match(logs, { onNone: () => 0, onSome: errorCount }),
      })),
    ),
    json("GET", "/api/error-reports", Effect.map(reportSettings, reportView)),
    json(
      "POST",
      "/api/error-reports",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(ReportChoicesBody), (choices) =>
        Effect.map(setReportChoices(choices), reportView),
      ),
    ),
    json("POST", "/api/error-reports/install-id", Effect.map(resetInstallId(), reportView)),
    json(
      "POST",
      "/api/usage/onboarding-finished",
      Effect.flatMap(HttpServerRequest.schemaBodyJson(OnboardingFinishedBody), (went) =>
        Effect.as(trackUsage("onboarding_finished", went), { ok: true }),
      ),
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
export const routes = (options: ServerOptions) => {
  const api = Layer.mergeAll(
    staticRoutes,
    apiRoutes(options),
    briefRoutes,
    renderRoutes,
    historyRoutes,
    approvalRoutes,
  );

  return options.webDir === undefined ? api : Layer.merge(api, boardRoutes(options.webDir));
};

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
