import type { Approval } from "./approvalsApi.ts";
import type { RenderState } from "./lib/render.ts";

/**
 * The SPA talks to the local Cutfac server. Same-origin by default; a hosted UI can point
 * at a local daemon with ?api=http://localhost:4317 (stored per browser).
 */
const API_BASE = readApiBase();

function readApiBase(): string {
  const fromQuery = new URLSearchParams(location.search).get("api");

  try {
    if (fromQuery !== null) localStorage.setItem("cutfac.api", fromQuery);

    return fromQuery ?? localStorage.getItem("cutfac.api") ?? "";
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

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);

  if (!res.ok) throw await failure(res);

  // SAFETY: each route's handler encodes its documented result type; see src/server/app.ts.
  return (await res.json()) as T;
}

export function send<T, Body>(method: "POST" | "PATCH", path: string, body: Body): Promise<T> {
  return request<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** What a person tells the people who make Cutfac, from the board's dialog or a `/feedback` message. */
export interface TeamFeedback {
  message: string;
  /** Where the team can reply; left out to stay anonymous. */
  email?: string;
  source: "board" | "slash";
  platform: string;
  locale: string;
  /** The agent the person works with; left out, the server names the workspace's default. */
  agent?: AgentName;
  /** Send the desktop app's recent log with it, which the person agreed to. */
  logs?: boolean;
}

/** Whether this build can send error reports, what the person chose, and this install's ID. */
export interface ErrorReports {
  available: boolean;
  /** Null until the person chooses. */
  errorReports: boolean | null;
  installId: string | null;
}

/** The `?id=` query naming an item. */
export const q = (id: string) => `?id=${encodeURIComponent(id)}`;

export const STATUSES = ["drafting", "review", "done", "archived"] as const;

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

/** A file or folder the user handed an agent, such as one in an item's `references/`. */
export interface Reference {
  /** Relative to what it belongs to, such as `references/logo.png` in an item. */
  path: string;
  name: string;
  dir: boolean;
  /** For a folder: how many files are in it, all the way down. */
  files?: number;
  /** Bytes; for a folder, of everything in it. */
  size: number;
  mtime: number;
  /** Set for a picture or video, which shows as a thumbnail. */
  kind?: MediaKind;
}

/** A file to upload with its path in what the user dropped: `logo.png`, `photos/a.jpg`. */
export interface Upload {
  file: File;
  path: string;
}

/** A form with the fields that are set and each file next to its path in the drop. */
function uploadForm(
  uploads: ReadonlyArray<Upload>,
  fields: Record<string, string | undefined> = {},
) {
  const form = new FormData();

  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined) form.set(name, value);
  }

  for (const { file, path } of uploads) {
    form.append("files", file);
    form.append("paths", path);
  }

  return form;
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

/** The model and effort a run uses; one left out is whatever the agent CLI defaults to. */
export interface ModelSettings {
  model?: string;
  effort?: string;
}

/** One version of an edit request, saved by the agent for the user to compare. */
export interface Variant {
  id: string;
  label: string;
  /** Item-relative copy of the media as this version. */
  file: string;
  at: string;
}

/** The versions an edit request asked for, saved so far, and the one the user kept. */
export interface Variants {
  wanted?: number;
  media?: string;
  saved: Variant[];
  picked?: string;
}

export interface AgentRun extends ModelSettings {
  agent: AgentName;
  status: "running" | "done" | "failed" | "stopped";
  startedAt: string;
  finishedAt?: string;
  reply?: string;
  error?: string;
  /** The agent compacted the conversation during the run, so it goes on from a summary. */
  compacted?: boolean;
  /** Whether a change of effort alone keeps the conversation's prompt cache, if the agent said. */
  effortKeepsCache?: boolean;
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
  /** Files the user attached, under the item's `references/`. */
  attachments?: string[];
  context?: EditContext;
  variants?: Variants;
  run?: AgentRun;
  /** Lined up for this agent behind the item's run and the requests before it. */
  waiting?: AgentName;
  /** The model the waiting request runs on. */
  model?: string;
  /** The effort the waiting request runs with. */
  effort?: string;
  /** When a request that waited began its run; its changes count from then. */
  baseline?: string;
  /** The request whose question from the agent this one answers. */
  answers?: string;
  status: "open" | "resolved";
  resolution?: string;
  resolvedAt?: string;
  decision?: "approved" | "restored";
}

/** What the board shows while an agent works: on a request on an item, or on a turn of an import. */
export type RunEvent =
  | ({ type: "start"; subject: string; agent: AgentName } & ModelSettings)
  | { type: "text"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "done"; reply: string }
  | { type: "stopped" }
  | { type: "error"; error: string }
  | { type: "compaction"; state: "running" | "done" | "failed" }
  /** The agent asks before using a tool; settled once answered, taken back, or the run stops. */
  | ({ type: "approval" } & Approval)
  | { type: "approval-settled"; id: string };

/**
 * What a run stream says: what the run is about (first on every connect), then its events. On an
 * item the subject is a request; on an import, a turn.
 */
export type RunMessage = RunEvent | { type: "run"; subject: string };

/** An edit request: what to change and, optionally, where. Without media it asks for new media. */
export interface EditInput extends ModelSettings {
  body: string;
  media?: string;
  timecode?: number;
  end?: number;
  region?: Region;
  /** Item-relative files under `references/` that go with the request. */
  attachments?: string[];
  /** How many versions to make and compare; 1 is a single edit. */
  variants?: number;
  agent: AgentChoice;
}

/** A note on an item that is not sent to an agent. */
export interface NewFeedback {
  body: string;
  media?: string;
  timecode?: number;
  attachments?: string[];
}

export interface EditReceipt {
  item: ItemDetail;
  feedbackId: string;
  sent: AgentChoice;
  warnings: string[];
  prompt: string;
}

export interface ItemSummary {
  id: string;
  dir: string;
  title: string;
  status: Status;
  format?: string;
  hook?: string;
  openFeedback: number;
  /**
   * The requests still open, or whose versions or result wait for the user to decide, oldest
   * first as saved.
   */
  requests: Feedback[];
  /** An agent works on the item right now. */
  running: boolean;
  /** How many of the agent's asks before a tool wait for the user to answer. */
  approvals: number;
  /** How many of the agent's questions, asked with its own tool, wait for the user's answer. */
  questions: number;
  /** The render going on, or the last one when it failed. */
  render?: RenderState;
  media: Media[];
  updatedAt: number;
}

/** A folder or file on this computer, or a web page, that agents should read for an item. */
export type ItemSource = { path: string } | { url: string };

export interface ItemDoc {
  title: string;
  status: Status;
  format?: string;
  /** What the user wants agents to read when they work on this item. */
  sources: ItemSource[];
  hook?: string;
  notes?: string;
  /** What was picked for the format's inputs, by input id. */
  inputs?: Partial<Record<string, string>>;
  feedback: Feedback[];
  /** The conversation each agent keeps about this item, resumed by every request to it. */
  sessions?: Partial<Record<AgentName, string>>;
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

export type DetailField = "title" | "status" | "hook" | "notes";

/** Item fields as a change left them; `null` is a field that was not set. */
export interface DetailValues {
  title?: string;
  status?: Status;
  hook?: string | null;
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
  /** An agent process is working on this item right now. */
  running: boolean;
  media: Media[];
  /** What the user gave the item to work from, in its `references/` folder; a folder is one entry. */
  references: Reference[];
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

/** How far platform UI reaches in from each edge: top and bottom of the height, sides of the width. */
export interface SafeZone {
  top: number;
  bottom: number;
  left: number;
  right: number;
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
  /** The margins dimmed on the frames, where platform UI covers the video. */
  safeZone?: SafeZone;
  /** What could not be made, and what was left out. */
  notes: string[];
}

export interface ItemPatch {
  status?: Status;
  title?: string;
  hook?: string;
  notes?: string;
  /** Replaces the item's whole list. */
  sources?: ItemSource[];
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

export type LearnedKind = "page" | "app" | "video" | "folder" | "file";

/** Something the user taught the workspace about, with what a first look found. */
export interface Learned {
  id: string;
  /** Workspace-relative folder; the doc's files are relative to it. */
  dir: string;
  doc: {
    kind: LearnedKind;
    title: string;
    description: string;
    /** None for an uploaded file. */
    source?: ItemSource;
    site?: string;
    icon?: string;
    images: string[];
    video?: string;
    probe?: Probe;
    links: string[];
    addedAt: string;
  };
  /** Whether no agent has read it into about.md yet. */
  unread: boolean;
}

export interface LearnedList {
  learned: Learned[];
  /** about.md, once anything is learned or written there. */
  about?: { path: string; text: string };
}

export interface LearnResult {
  learned: Learned;
  warnings: string[];
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

export interface WorkspaceInfo {
  name: string;
  root: string;
  config: {
    agent: { default: AgentChoice };
  };
  formats: Format[];
  openFeedback: number;
}

/**
 * Which Cutfac serves the board: the open-source version, which has no limit, or the desktop app,
 * on a paid plan or its free version with the videos it has made on this Mac.
 */
export type Plan =
  | { edition: "open-source" }
  | { edition: "desktop"; paid: true }
  | { edition: "desktop"; paid: false; used: number; limit: number };

/** A model the board offers for an agent, and the efforts it takes. */
export interface ModelOption {
  /** What the agent CLI takes, such as `opus`. */
  id: string;
  label: string;
  efforts: string[];
  defaultEffort?: string;
  /** Whether a change of effort alone keeps the agent's prompt cache; left out when unknown. */
  effortKeepsCache?: boolean;
}

export interface AgentStatus {
  agent: AgentName;
  installed: boolean;
  connected: boolean;
  models: ModelOption[];
  /** The efforts that suit whatever model the agent picks itself. */
  efforts: string[];
  /** The name of the model the agent runs when none is picked, such as `Sonnet 5`, if known. */
  defaultModel?: string;
  /** The release the agent's CLI reports, if it does. */
  version?: string;
  /** Set when that release is older than Cutfac supports: the oldest one that is, and how to update. */
  outdated?: { minimum: string; update: string };
}

/** A setting the workspace has Claude Code act on by itself, or a whole file that is not JSON. */
export type TrustItem =
  | { file: string; key: string; value: unknown }
  | { file: string; value: string };

/** Whether Claude waits for the user to trust the workspace's settings before it runs. */
export interface TrustStatus {
  needed: boolean;
  items: TrustItem[];
  /** Names exactly these settings; trusting it doesn't trust ones changed since. */
  fingerprint: string;
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

/** The user's side of a template import: the link, a reply, or Allow with an optional note. */
export interface ImportTurn {
  id: string;
  at: string;
  kind: "start" | "reply" | "allow";
  body: string;
  /** The files sent with it, relative to the import's `dir`, such as `files/logo.png`. */
  attachments?: string[];
  run?: AgentRun;
}

/**
 * Bringing a template in from a link, or making one from the workspace brief: the conversation
 * with the agent and what it added.
 */
export interface ImportDoc {
  kind: "link" | "brief";
  /** Where the template comes from; a brief import may go without one. */
  link?: string;
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

/** An import as the list of imports shows it. */
export interface ImportSummary {
  id: string;
  doc: ImportDoc;
  running: boolean;
}

/** An import as its chat shows it. */
export interface ImportDetail extends ImportSummary {
  /** Workspace-relative folder of the import, which the paths of its files are relative to. */
  dir: string;
  /** Every file the user sent to the import's agent. */
  references: Reference[];
}

export interface NewImport {
  /** Only a brief import may go without a link. */
  link?: string;
  kind?: ImportDoc["kind"];
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
  plan: () => request<Plan>("/api/plan"),
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
  /** Keep files as the item's references; a dropped folder keeps its structure. */
  uploadReferences: (id: string, uploads: ReadonlyArray<Upload>) =>
    request<{ item: ItemDetail; added: string[] }>(`/api/item/references${q(id)}`, {
      method: "POST",
      body: uploadForm(uploads),
    }),
  /** Download a video link with yt-dlp into the item's references. */
  addLinkedVideo: (id: string, url: string) =>
    send<{ item: ItemDetail; added: string[] }, { url: string }>(
      "POST",
      `/api/item/references/link${q(id)}`,
      { url },
    ),
  removeReference: (id: string, path: string) =>
    send<ItemDetail, { path: string }>("POST", `/api/item/references/remove${q(id)}`, { path }),
  addFeedback: (id: string, input: NewFeedback) =>
    send<ItemDetail, NewFeedback>("POST", `/api/item/feedback${q(id)}`, input),
  resolveFeedback: (id: string, feedbackId: string) =>
    send<ItemDetail, { feedbackId: string }>("POST", `/api/item/feedback/resolve${q(id)}`, {
      feedbackId,
    }),
  requestEdit: (id: string, input: EditInput) =>
    send<EditReceipt, EditInput>("POST", `/api/item/edit${q(id)}`, input),
  runEdit: (id: string, feedbackId: string, agent: AgentName, settings: ModelSettings) =>
    send<{ ok: true }, { feedbackId: string; agent: AgentName } & ModelSettings>(
      "POST",
      `/api/item/edit/run${q(id)}`,
      { feedbackId, agent, ...settings },
    ),
  /** Run the requests waiting on the item again, after a run before them failed or was stopped. */
  continueEdits: (id: string) =>
    send<{ ok: true }, {}>("POST", `/api/item/edit/continue${q(id)}`, {}),
  /** Take a waiting request out of the line, or every one when no id is given. */
  cancelWaiting: (id: string, feedbackId?: string) =>
    send<ItemDetail, { feedbackId?: string }>(
      "POST",
      `/api/item/edit/cancel${q(id)}`,
      feedbackId === undefined ? {} : { feedbackId },
    ),
  rewordWaiting: (id: string, feedbackId: string, body: string) =>
    send<ItemDetail, { feedbackId: string; body: string }>(
      "POST",
      `/api/item/edit/reword${q(id)}`,
      { feedbackId, body },
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
  /** Keep one of a request's versions; the others are thrown away. */
  pickVariant: (id: string, feedbackId: string, variantId: string) =>
    send<ItemDetail, { feedbackId: string; variantId: string }>(
      "POST",
      `/api/item/edit/pick${q(id)}`,
      { feedbackId, variantId },
    ),
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
  trust: () => request<TrustStatus>("/api/trust"),
  trustWorkspace: (fingerprint: string) =>
    send<TrustStatus, { fingerprint: string }>("POST", "/api/trust", { fingerprint }),
  feedback: () => request<OpenFeedback[]>("/api/feedback"),
  /** Feedback for the Cutfac team, which the server passes on to cutfac.com. */
  teamFeedback: (feedback: TeamFeedback) =>
    send<{ ok: true }, TeamFeedback>("POST", "/api/team-feedback", feedback),
  /**
   * The log feedback would carry, for the person to read first, and how many errors it holds;
   * no log outside the desktop app.
   */
  teamFeedbackLogs: () =>
    request<{ logs: string | null; errors: number }>("/api/team-feedback/logs"),
  errorReports: () => request<ErrorReports>("/api/error-reports"),
  setErrorReports: (on: boolean) =>
    send<ErrorReports, { on: boolean }>("POST", "/api/error-reports", { on }),
  resetInstallId: () => send<ErrorReports, {}>("POST", "/api/error-reports/install-id", {}),
  learned: () => request<LearnedList>("/api/learned"),
  /** Learn a link, or a folder or file on this computer. */
  learn: (source: string) =>
    send<LearnResult, { source: string }>("POST", "/api/learn", { source }),
  learnFile: (file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request<LearnResult>("/api/learn", { method: "POST", body: form });
  },
  /** Remove an entry and its section of about.md; answers with what is left. */
  forgetLearned: (id: string) => send<LearnedList, {}>("POST", `/api/learned/forget${q(id)}`, {}),
  formats: () => request<Format[]>("/api/formats"),
  formatStatuses: () => request<FormatStatus[]>("/api/formats/status"),
  imports: () => request<ImportSummary[]>("/api/imports"),
  import: (id: string) => request<ImportDetail>(`/api/import${q(id)}`),
  /**
   * Start the user's agent on a link and any files that go with it. It can only read until the user
   * allows installs.
   */
  startImport: (input: NewImport, uploads: ReadonlyArray<Upload> = []) =>
    uploads.length === 0
      ? send<ImportDetail, NewImport>("POST", "/api/imports", input)
      : request<ImportDetail>("/api/imports", {
          method: "POST",
          body: uploadForm(uploads, { ...input }),
        }),
  replyImport: (id: string, body: string, uploads: ReadonlyArray<Upload> = []) =>
    uploads.length === 0
      ? send<ImportDetail, ImportReply>("POST", `/api/import/reply${q(id)}`, { body })
      : request<ImportDetail>(`/api/import/reply${q(id)}`, {
          method: "POST",
          body: uploadForm(uploads, { body }),
        }),
  /** Let the agent install and write what it listed, with an optional note. */
  allowImport: (id: string, body: string) =>
    send<ImportDetail, ImportReply>("POST", `/api/import/reply${q(id)}`, { body, allow: true }),
  stopImport: (id: string) => send<ImportDetail, {}>("POST", `/api/import/stop${q(id)}`, {}),
  /** Stop the agent if it is working and set the import aside. */
  closeImport: (id: string) => send<ImportDetail, {}>("POST", `/api/import/close${q(id)}`, {}),
};

export function eventData(event: Event): string {
  // SAFETY: EventSource dispatches named server-sent events as MessageEvents with string data.
  return (event as MessageEvent<string>).data;
}

/** A stream of server-sent events from the local server. */
export const openEvents = (path: string) => new EventSource(`${API_BASE}${path}`);

/**
 * The latest agent run at `path`: a `run` message naming what it is about, its events from the
 * start, then live ones. A reconnect replays it all again from `run`.
 */
function onRun(path: string, listener: (message: RunMessage) => void): () => void {
  const source = openEvents(path);

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
