import { Schema } from "effect";

import {
  AgentChoice,
  type AgentName,
  Feedback,
  HistoryDoc,
  ItemDoc,
  type ItemPatch,
  ItemStatus,
  type ModelSettings,
  type Region,
  ReviewDoc,
} from "../../../src/core/schema.ts";
import { RenderState } from "../lib/render.ts";
import { Ok, q, request, send, uploadForm, type Upload } from "./client.ts";

export {
  DetailsChange,
  Feedback,
  HistoryDoc,
  HistoryEntry,
  ItemPatch,
  ItemSource,
  MediaChange,
  MediaVersion,
  Region,
  SafeZone,
  Variant,
  ITEM_STATUSES as STATUSES,
  ItemStatus as Status,
  type DetailField,
  type MediaCause,
} from "../../../src/core/schema.ts";

export const MediaKind = Schema.Literals(["video", "image"]);

export type MediaKind = typeof MediaKind.Type;

export const Media = Schema.Struct({
  name: Schema.String,
  kind: MediaKind,
  aspect: Schema.optionalKey(Schema.String),
  size: Schema.Finite,
  /** Milliseconds since the epoch; changes whenever an agent rewrites the file. */
  mtime: Schema.Finite,
});

export type Media = typeof Media.Type;

/** A file or folder the user handed an agent, such as one in an item's `references/`. */
export const Reference = Schema.Struct({
  /** Relative to what it belongs to, such as `references/logo.png` in an item. */
  path: Schema.String,
  name: Schema.String,
  dir: Schema.Boolean,
  /** For a folder: how many files are in it, all the way down. */
  files: Schema.optionalKey(Schema.Finite),
  /** Bytes; for a folder, of everything in it. */
  size: Schema.Finite,
  mtime: Schema.Finite,
  /** Set for a picture or video, which shows as a thumbnail. */
  kind: Schema.optionalKey(MediaKind),
});

export type Reference = typeof Reference.Type;

export const ItemSummary = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  title: Schema.String,
  status: ItemStatus,
  format: Schema.optionalKey(Schema.String),
  hook: Schema.optionalKey(Schema.String),
  openFeedback: Schema.Finite,
  /**
   * The requests still open, or whose versions or result wait for the user to decide, oldest
   * first as saved.
   */
  requests: Schema.Array(Feedback),
  /** An agent works on the item right now. */
  running: Schema.Boolean,
  /** How many of the agent's asks before a tool wait for the user to answer. */
  approvals: Schema.Finite,
  /** How many of the agent's questions, asked with its own tool, wait for the user's answer. */
  questions: Schema.Finite,
  /** The render going on, or the last one when it failed. */
  render: Schema.optionalKey(RenderState),
  media: Schema.Array(Media),
  updatedAt: Schema.Finite,
});

export type ItemSummary = typeof ItemSummary.Type;

/** The frames an agent last rendered to judge one of the item's videos. */
export const MediaReview = Schema.Struct({
  /** Workspace-relative folder holding the files below. */
  dir: Schema.String,
  ...ReviewDoc.fields,
});

export type MediaReview = typeof MediaReview.Type;

export const ItemDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  /** An agent process is working on this item right now. */
  running: Schema.Boolean,
  media: Schema.Array(Media),
  /** What the user gave the item to work from, in its `references/` folder; a folder is one entry. */
  references: Schema.Array(Reference),
  /** Markdown files in the item folder, by file name. */
  docs: Schema.Record(Schema.String, Schema.String),
  doc: ItemDoc,
  history: HistoryDoc,
  /** The agent's last frame review of each video. */
  reviews: Schema.Array(MediaReview),
  updatedAt: Schema.Finite,
});

export type ItemDetail = typeof ItemDetail.Type;

export const EditReceipt = Schema.Struct({
  item: ItemDetail,
  feedbackId: Schema.String,
  sent: AgentChoice,
  warnings: Schema.Array(Schema.String),
  prompt: Schema.String,
});

export type EditReceipt = typeof EditReceipt.Type;

export const OpenFeedback = Schema.Struct({
  item: Schema.String,
  title: Schema.String,
  feedback: Feedback,
});

export type OpenFeedback = typeof OpenFeedback.Type;

const MediaReport = Schema.Struct({
  file: Schema.String,
  ok: Schema.Boolean,
  checks: Schema.Array(
    Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.String }),
  ),
});

export type MediaReport = typeof MediaReport.Type;

/** An edit request: what to change and, optionally, where. Without media it asks for new media. */
export interface EditInput extends ModelSettings {
  body: string;
  media?: string;
  timecode?: number;
  end?: number;
  region?: Region;
  /** Item-relative files under `references/` that go with the request. */
  attachments?: ReadonlyArray<string>;
  /** How many versions to make and compare; 1 is a single edit. */
  variants?: number;
  agent: AgentChoice;
}

/** A note on an item that is not sent to an agent. */
export interface NewFeedback {
  body: string;
  media?: string;
  timecode?: number;
  attachments?: ReadonlyArray<string>;
}

export interface NewItem {
  title: string;
  format?: string;
  /** Values for the format's inputs by input id; the server fills in defaults. */
  inputs?: Record<string, string>;
}

const Prompt = Schema.Struct({ prompt: Schema.String });

const Added = Schema.Struct({ item: ItemDetail, added: Schema.Array(Schema.String) });

export const itemApi = {
  items: () => request(Schema.Array(ItemSummary), "/api/items"),
  item: (id: string) => request(ItemDetail, `/api/item${q(id)}`),
  createItem: (input: NewItem) => send(ItemDetail, "POST", "/api/items", input),
  updateItem: (id: string, patch: ItemPatch) =>
    send(ItemDetail, "PATCH", `/api/item${q(id)}`, patch),
  /** Add a video or image to the item. The server prefixes the name with its aspect, e.g. `[9x16]`. */
  uploadMedia: (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request(ItemDetail, `/api/item/media${q(id)}`, { method: "POST", body: form });
  },
  /** Keep files as the item's references; a dropped folder keeps its structure. */
  uploadReferences: (id: string, uploads: ReadonlyArray<Upload>) =>
    request(Added, `/api/item/references${q(id)}`, { method: "POST", body: uploadForm(uploads) }),
  /** Download a video link with yt-dlp into the item's references. */
  addLinkedVideo: (id: string, url: string) =>
    send(Added, "POST", `/api/item/references/link${q(id)}`, { url }),
  removeReference: (id: string, path: string) =>
    send(ItemDetail, "POST", `/api/item/references/remove${q(id)}`, { path }),
  addFeedback: (id: string, input: NewFeedback) =>
    send(ItemDetail, "POST", `/api/item/feedback${q(id)}`, input),
  resolveFeedback: (id: string, feedbackId: string) =>
    send(ItemDetail, "POST", `/api/item/feedback/resolve${q(id)}`, { feedbackId }),
  requestEdit: (id: string, input: EditInput) =>
    send(EditReceipt, "POST", `/api/item/edit${q(id)}`, input),
  runEdit: (id: string, feedbackId: string, agent: AgentName, settings: ModelSettings) =>
    send(Ok, "POST", `/api/item/edit/run${q(id)}`, { feedbackId, agent, ...settings }),
  /** Run the requests waiting on the item again, after a run before them failed or was stopped. */
  continueEdits: (id: string) => send(Ok, "POST", `/api/item/edit/continue${q(id)}`, {}),
  /** Take a waiting request out of the line, or every one when no id is given. */
  cancelWaiting: (id: string, feedbackId?: string) =>
    send(
      ItemDetail,
      "POST",
      `/api/item/edit/cancel${q(id)}`,
      feedbackId === undefined ? {} : { feedbackId },
    ),
  rewordWaiting: (id: string, feedbackId: string, body: string) =>
    send(ItemDetail, "POST", `/api/item/edit/reword${q(id)}`, { feedbackId, body }),
  /** Interrupt the agent working on this item; the request stays open. */
  stopEdit: (id: string) => send(Ok, "POST", `/api/item/edit/stop${q(id)}`, {}),
  editPrompt: (id: string, feedbackId: string) =>
    request(Prompt, `/api/item/edit/prompt${q(id)}&feedbackId=${encodeURIComponent(feedbackId)}`),
  approveEdit: (id: string, feedbackId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/approve${q(id)}`, { feedbackId }),
  /** Keep one of a request's versions; the others are thrown away. */
  pickVariant: (id: string, feedbackId: string, variantId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/pick${q(id)}`, { feedbackId, variantId }),
  restoreEdit: (id: string, feedbackId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/restore${q(id)}`, { feedbackId }),
  /** Take back the item's latest change: an edit, a rollback, or a field. */
  undo: (id: string) => send(ItemDetail, "POST", `/api/item/history/undo${q(id)}`, {}),
  redo: (id: string) => send(ItemDetail, "POST", `/api/item/history/redo${q(id)}`, {}),
  /** Undo or redo up to the state right after `entryId`, or back to the start without one. */
  goTo: (id: string, entryId: string | undefined) =>
    send(
      ItemDetail,
      "POST",
      `/api/item/history/goto${q(id)}`,
      entryId === undefined ? {} : { entryId },
    ),
  /** Put a saved version back in place, as a change of its own that can be undone. */
  restoreVersion: (id: string, versionId: string) =>
    send(ItemDetail, "POST", `/api/item/history/version${q(id)}`, { versionId }),
  verify: (id: string) => request(Schema.Array(MediaReport), `/api/item/verify${q(id)}`),
  feedback: () => request(Schema.Array(OpenFeedback), "/api/feedback"),
};
