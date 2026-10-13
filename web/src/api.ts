/**
 * The SPA talks to the local factory server. Same-origin by default; a hosted UI can point
 * at a local daemon with ?api=http://localhost:4317 (stored per browser).
 */
const API_BASE = readApiBase();

function readApiBase(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");

  try {
    if (fromQuery !== null) localStorage.setItem("factory.api", fromQuery);

    return fromQuery ?? localStorage.getItem("factory.api") ?? "";
  } catch {
    return fromQuery ?? "";
  }
}

/**
 * URL of a workspace file. Agents rewrite media under the same name, so pass the file's mtime
 * as `version` to make the browser fetch the new bytes instead of a cached copy.
 */
export function fileUrl(rel: string, version?: number): string {
  const path = rel.split("/").map(encodeURIComponent).join("/");

  return version === undefined
    ? `${API_BASE}/files/${path}`
    : `${API_BASE}/files/${path}?v=${version}`;
}

/** Every failed /api request answers with this body. */
interface ApiFailure {
  readonly error: string;
}

async function failure(res: Response): Promise<Error> {
  try {
    // SAFETY: the server encodes every failed /api response as `{ error }`.
    const body = (await res.json()) as ApiFailure;

    return new Error(body.error);
  } catch {
    return new Error(`${res.status} ${res.statusText}`);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) throw await failure(res);

  // SAFETY: each route's handler encodes its documented result type; see src/server/app.ts.
  return (await res.json()) as T;
}

function send<T, Body>(method: "POST" | "PATCH", path: string, body: Body): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const q = (id: string) => `?id=${encodeURIComponent(id)}`;

export const STATUSES = [
  "idea",
  "drafting",
  "review",
  "approved",
  "scheduled",
  "published",
  "archived",
] as const;

export type Status = (typeof STATUSES)[number];

export type MediaKind = "video" | "image";

export interface Media {
  name: string;
  kind: MediaKind;
  aspect?: string;
  size: number;
  /** Milliseconds since the epoch; changes whenever an agent rewrites the file. */
  mtime: number;
}

export interface Schedule {
  platform: string;
  at: string;
  status: string;
  url?: string;
}

export type AgentName = "claude" | "codex";

export type AgentChoice = AgentName | "queue";

/** A box on one frame, as fractions of the frame; `at` is the frame's time in seconds. */
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
  at: number;
}

export interface EditContext {
  clip?: string;
  frame?: string;
  before?: string;
  after?: string;
}

export interface AgentRun {
  agent: AgentName;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  reply?: string;
  error?: string;
}

export interface Feedback {
  id: string;
  at: string;
  author: string;
  body: string;
  media?: string;
  timecode?: number;
  end?: number;
  region?: Region;
  context?: EditContext;
  run?: AgentRun;
  status: "open" | "resolved";
  resolution?: string;
  resolvedAt?: string;
  decision?: "approved" | "restored";
}

/** What the board shows while an agent works: on a request on an item, or on a turn of an import. */
export type RunEvent =
  | { type: "start"; subject: string; agent: AgentName }
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "done"; reply: string }
  | { type: "stopped" }
  | { type: "error"; error: string };

/**
 * What a run stream says: what the run is about (first on every connect), then its events. On an
 * item the subject is a request; on an import, a turn.
 */
export type RunMessage = RunEvent | { type: "run"; subject: string };

/** An edit request: what to change and, optionally, where. Without media it asks for new media. */
export interface EditInput {
  body: string;
  media?: string;
  timecode?: number;
  end?: number;
  region?: Region;
  agent: AgentChoice;
}

/** A note on an item that is not sent to an agent. */
export interface NewFeedback {
  body: string;
  media?: string;
  timecode?: number;
}

export interface EditReceipt {
  item: ItemDetail;
  feedbackId: string;
  sent: AgentChoice;
  warnings: string[];
  prompt: string;
}

export interface Metrics {
  platform: string;
  at: string;
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  follows?: number;
  installs?: number;
}

export interface ItemSummary {
  id: string;
  dir: string;
  legacy: boolean;
  title: string;
  status: Status;
  format?: string;
  hook?: string;
  schedule: Schedule[];
  openFeedback: number;
  media: Media[];
  updatedAt: number;
}

export interface PlatformCopy {
  title?: string;
  caption?: string;
  hashtags?: string[];
  firstComment?: string;
}

export interface ItemDoc {
  title: string;
  status: Status;
  format?: string;
  reference?: string;
  hook?: string;
  caption?: string;
  notes?: string;
  /** What was picked for the format's inputs, by input id. */
  inputs?: Partial<Record<string, string>>;
  platforms: Partial<Record<string, PlatformCopy>>;
  schedule: Schedule[];
  metrics: Metrics[];
  feedback: Feedback[];
  created?: string;
  updated?: string;
}

/** A saved copy of a media file, kept so any change to it can be undone. */
export interface MediaVersion {
  id: string;
  /** The media file this is a version of. */
  media: string;
  /** Item-relative path of the copy. */
  file: string;
  at: string;
  size: number;
}

export interface MediaHead {
  version: string;
  size: number;
  mtime: number;
}

/**
 * Why a media file changed: an agent's `edit`, a `restore` to before a request, a `version`
 * picked from the history, or a change made `outside` any request.
 */
export type MediaCause = "edit" | "restore" | "version" | "outside";

export interface MediaChange {
  kind: "media";
  id: string;
  at: string;
  media: string;
  from: string;
  to: string;
  cause: MediaCause;
  feedbackId?: string;
}

export type DetailField = "title" | "status" | "hook" | "caption" | "notes";

/** Item fields as a change left them; `null` is a field that was not set. */
export interface DetailValues {
  title?: string;
  status?: Status;
  hook?: string | null;
  caption?: string | null;
  notes?: string | null;
}

export interface DetailsChange {
  kind: "details";
  id: string;
  at: string;
  before: DetailValues;
  after: DetailValues;
}

export type HistoryEntry = MediaChange | DetailsChange;

/** Saved media versions and the item's undo stack. */
export interface HistoryDoc {
  /** Entries before this index are applied; the ones after it can be redone. */
  cursor: number;
  entries: HistoryEntry[];
  versions: MediaVersion[];
  heads: Partial<Record<string, MediaHead>>;
}

export interface ItemDetail {
  id: string;
  dir: string;
  legacy: boolean;
  /** An agent process is working on this item right now. */
  running: boolean;
  media: Media[];
  /** Markdown files in the item folder, by file name. */
  docs: Partial<Record<string, string>>;
  doc: ItemDoc;
  history: HistoryDoc;
  /** The agent's last frame review of each video. */
  reviews: MediaReview[];
  updatedAt: number;
}

/** A frame, or a strip of frames, at `t` seconds; `file` is relative to the review's `dir`. */
export interface ReviewShot {
  t: number;
  file: string;
}

/** The frames an agent last rendered to judge one of the item's videos. */
export interface MediaReview {
  /** Workspace-relative folder holding the files below. */
  dir: string;
  /** The video's name in the item. */
  file: string;
  at: string;
  /** Every frame on one image, in time order. */
  sheet?: string;
  frames: ReviewShot[];
  /** Frames across each transition, where half-finished motion shows. */
  strips: ReviewShot[];
  /** What could not be made, and what was left out. */
  notes: string[];
}

export interface ItemPatch {
  status?: Status;
  title?: string;
  caption?: string;
  hook?: string;
  notes?: string;
}

export interface NewItem {
  title: string;
  format?: string;
  /** Values for the format's inputs by input id; the server fills in defaults. */
  inputs?: Record<string, string>;
}

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

export interface MediaReport {
  file: string;
  ok: boolean;
  checks: Check[];
}

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
}

export interface Reference {
  id: string;
  dir: string;
  doc: {
    title: string;
    source?: string;
    video?: string;
    addedAt: string;
    tags: string[];
    probe?: Probe;
    preprocessed: boolean;
  };
  analysis?: string;
  preprocess?: {
    cuts: number[];
    frames: { file: string; t: number }[];
    contactSheet?: string;
    audio?: string;
    transcript?: string;
    notes: string[];
  };
}

export interface InputChoice {
  id: string;
  title: string;
  summary?: string;
  /** Format-relative image or clip that shows the choice. */
  preview?: string;
  files: string[];
}

/** Something the user picks or writes when making an item in a format. */
export interface InputField {
  id: string;
  title: string;
  description?: string;
  /** Empty for free text. */
  choices: InputChoice[];
  default?: string;
  required: boolean;
}

export interface Format {
  id: string;
  dir: string;
  doc: {
    title: string;
    summary: string;
    references: string[];
    aspects: string[];
    duration?: { min: number; max: number };
    requireAudio: boolean;
    hookRules: string[];
    structure: string[];
    checklist: string[];
    source?: { url?: string; author?: string; license?: string };
    skills: { name: string; source?: string }[];
    requires: string[];
    tools: string[];
    inputs: InputField[];
  };
  readme?: string;
}

export type FormatProblemKind = "spec" | "skill" | "program" | "file";

export interface FormatProblem {
  kind: FormatProblemKind;
  subject: string;
  message: string;
}

/** A format folder, readable or not, and what stands between it and its first item. */
export interface FormatStatus {
  id: string;
  format?: Format;
  check: {
    ready: boolean;
    problems: FormatProblem[];
    /** Workspace-relative SKILL.md of each installed skill the format names. */
    skills: Partial<Record<string, string>>;
  };
}

export interface ProductDoc {
  name: string;
  oneLiner: string;
  audience: string;
  stores: { appStore?: string; googlePlay?: string; web?: string };
  cta: { default: string; firstComment?: string };
  brand: { colors: Partial<Record<string, string>>; fonts: string[]; voice: string };
  rules: string[];
}

export interface WorkspaceInfo {
  name: string;
  root: string;
  config: {
    timezone: string;
    platforms: string[];
    paths: { product: string; references: string; formats: string; items: string };
    agent: { default: AgentChoice };
  };
  product: {
    doc?: ProductDoc;
    captures: Media[];
    store: Media[];
    notes?: string;
  };
  formats: Format[];
  openFeedback: number;
}

export interface AgentStatus {
  agent: AgentName;
  installed: boolean;
  connected: boolean;
}

export interface AgentConnection {
  agent: AgentName;
  ok: boolean;
  detail: string;
}

export interface OpenFeedback {
  item: string;
  title: string;
  feedback: Feedback;
}

export interface ImportResult {
  warnings: string[];
  files: string[];
}

/** The user's side of a template import: the link, a reply, or Allow with an optional note. */
export interface ImportTurn {
  id: string;
  at: string;
  kind: "start" | "reply" | "allow";
  body: string;
  run?: AgentRun;
}

/** Bringing a template in from a link: the conversation with the agent and what it added. */
export interface ImportDoc {
  link: string;
  agent: AgentName;
  locale?: string;
  /** The user pressed Allow; until then the agent may only read. */
  allowed: boolean;
  turns: ImportTurn[];
  /** Skills and formats the import added, once it was allowed to. */
  skills: string[];
  formats: string[];
  closed: boolean;
  created: string;
  updated: string;
}

export interface ImportDetail {
  id: string;
  doc: ImportDoc;
  running: boolean;
}

export interface NewImport {
  link: string;
  agent?: AgentName;
  /** The board's language, for the agent to write in. */
  locale?: string;
}

interface ImportReply {
  body?: string;
  allow?: boolean;
}

export const api = {
  health: () => request<{ ok: true }>("/api/health"),
  workspace: () => request<WorkspaceInfo>("/api/workspace"),
  items: () => request<ItemSummary[]>("/api/items"),
  item: (id: string) => request<ItemDetail>(`/api/item${q(id)}`),
  createItem: (input: NewItem) => send<ItemDetail, NewItem>("POST", "/api/items", input),
  updateItem: (id: string, patch: ItemPatch) =>
    send<ItemDetail, ItemPatch>("PATCH", `/api/item${q(id)}`, patch),
  /** Add a video or image to the item. The server prefixes the name with its aspect, e.g. `[9x16]`. */
  uploadMedia: (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request<ItemDetail>(`/api/item/media${q(id)}`, { method: "POST", body: form });
  },
  addFeedback: (id: string, input: NewFeedback) =>
    send<ItemDetail, NewFeedback>("POST", `/api/item/feedback${q(id)}`, input),
  resolveFeedback: (id: string, feedbackId: string) =>
    send<ItemDetail, { feedbackId: string }>("POST", `/api/item/feedback/resolve${q(id)}`, {
      feedbackId,
    }),
  requestEdit: (id: string, input: EditInput) =>
    send<EditReceipt, EditInput>("POST", `/api/item/edit${q(id)}`, input),
  runEdit: (id: string, feedbackId: string, agent: AgentName) =>
    send<{ ok: true }, { feedbackId: string; agent: AgentName }>(
      "POST",
      `/api/item/edit/run${q(id)}`,
      { feedbackId, agent },
    ),
  /** Interrupt the agent working on this item; the request stays open. */
  stopEdit: (id: string) => send<{ ok: true }, {}>("POST", `/api/item/edit/stop${q(id)}`, {}),
  editPrompt: (id: string, feedbackId: string) =>
    request<{ prompt: string }>(
      `/api/item/edit/prompt${q(id)}&feedbackId=${encodeURIComponent(feedbackId)}`,
    ),
  approveEdit: (id: string, feedbackId: string) =>
    send<ItemDetail, { feedbackId: string }>("POST", `/api/item/edit/approve${q(id)}`, {
      feedbackId,
    }),
  restoreEdit: (id: string, feedbackId: string) =>
    send<ItemDetail, { feedbackId: string }>("POST", `/api/item/edit/restore${q(id)}`, {
      feedbackId,
    }),
  /** Take back the item's latest change: an edit, a rollback, or a field. */
  undo: (id: string) => send<ItemDetail, {}>("POST", `/api/item/history/undo${q(id)}`, {}),
  redo: (id: string) => send<ItemDetail, {}>("POST", `/api/item/history/redo${q(id)}`, {}),
  /** Undo or redo up to the state right after `entryId`, or back to the start without one. */
  goTo: (id: string, entryId: string | undefined) =>
    send<ItemDetail, { entryId?: string }>(
      "POST",
      `/api/item/history/goto${q(id)}`,
      entryId === undefined ? {} : { entryId },
    ),
  /** Put a saved version back in place, as a change of its own that can be undone. */
  restoreVersion: (id: string, versionId: string) =>
    send<ItemDetail, { versionId: string }>("POST", `/api/item/history/version${q(id)}`, {
      versionId,
    }),
  verify: (id: string) => request<MediaReport[]>(`/api/item/verify${q(id)}`),
  agents: () => request<AgentStatus[]>("/api/agents"),
  connectAgent: (agent: AgentName) =>
    send<AgentConnection, { agent: AgentName }>("POST", "/api/agents/connect", { agent }),
  importProduct: (url: string) =>
    send<ImportResult, { url: string }>("POST", "/api/product/import", { url }),
  feedback: () => request<OpenFeedback[]>("/api/feedback"),
  references: () => request<Reference[]>("/api/references"),
  reference: (id: string) => request<Reference>(`/api/reference${q(id)}`),
  addReferenceUrl: (url: string) =>
    send<Reference, { url: string }>("POST", "/api/references", { url }),
  addReferenceFile: (file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request<Reference>("/api/references", { method: "POST", body: form });
  },
  formats: () => request<Format[]>("/api/formats"),
  formatStatuses: () => request<FormatStatus[]>("/api/formats/status"),
  imports: () => request<ImportDetail[]>("/api/imports"),
  import: (id: string) => request<ImportDetail>(`/api/import${q(id)}`),
  /** Start the user's agent on a link. It can only read until the user allows installs. */
  startImport: (input: NewImport) => send<ImportDetail, NewImport>("POST", "/api/imports", input),
  replyImport: (id: string, body: string) =>
    send<ImportDetail, ImportReply>("POST", `/api/import/reply${q(id)}`, { body }),
  /** Let the agent install and write what it listed, with an optional note. */
  allowImport: (id: string, body: string) =>
    send<ImportDetail, ImportReply>("POST", `/api/import/reply${q(id)}`, { body, allow: true }),
  stopImport: (id: string) => send<ImportDetail, {}>("POST", `/api/import/stop${q(id)}`, {}),
  /** Stop the agent if it is working and set the import aside. */
  closeImport: (id: string) => send<ImportDetail, {}>("POST", `/api/import/close${q(id)}`, {}),
};

function eventData(event: Event): string {
  // SAFETY: EventSource dispatches named server-sent events as MessageEvents with string data.
  return (event as MessageEvent<string>).data;
}

/**
 * The latest agent run at `path`: a `run` message naming what it is about, its events from the
 * start, then live ones. A reconnect replays it all again from `run`.
 */
function onRun(path: string, listener: (message: RunMessage) => void): () => void {
  const source = new EventSource(`${API_BASE}${path}`);

  source.addEventListener("run", (e) => {
    listener({ type: "run", subject: eventData(e) });
  });

  source.addEventListener("agent", (e) => {
    // SAFETY: the server writes each `agent` event as one JSON-encoded RunEvent.
    listener(JSON.parse(eventData(e)) as RunEvent);
  });

  return () => source.close();
}

/** The item's latest agent run, about one of its requests. */
export const onAgentRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/item/run${q(id)}`, listener);

/** The import's latest agent run, about one of its turns. */
export const onImportRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/import/run${q(id)}`, listener);

/**
 * Workspace file changes, so agent writes appear live. Every subscriber shares one
 * EventSource: browsers allow only six HTTP/1.1 connections per origin.
 */
const changeListeners = new Set<() => void>();

let changeSource: EventSource | undefined;

export function onWorkspaceChange(listener: () => void): () => void {
  changeListeners.add(listener);

  if (changeSource === undefined) {
    changeSource = new EventSource(`${API_BASE}/api/events`);
    changeSource.addEventListener("change", () => {
      for (const notify of changeListeners) notify();
    });
  }

  return () => {
    changeListeners.delete(listener);

    if (changeListeners.size === 0) {
      changeSource?.close();
      changeSource = undefined;
    }
  };
}
