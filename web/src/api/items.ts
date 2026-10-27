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
  mtime: Schema.Finite,
});

export type Media = typeof Media.Type;

export const Reference = Schema.Struct({
  path: Schema.String,
  name: Schema.String,
  dir: Schema.Boolean,
  files: Schema.optionalKey(Schema.Finite),
  size: Schema.Finite,
  mtime: Schema.Finite,
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
  requests: Schema.Array(Feedback),
  running: Schema.Boolean,
  approvals: Schema.Finite,
  questions: Schema.Finite,
  render: Schema.optionalKey(RenderState),
  media: Schema.Array(Media),
  updatedAt: Schema.Finite,
});

export type ItemSummary = typeof ItemSummary.Type;

export const MediaReview = Schema.Struct({
  dir: Schema.String,
  ...ReviewDoc.fields,
});

export type MediaReview = typeof MediaReview.Type;

export const ItemDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  running: Schema.Boolean,
  media: Schema.Array(Media),
  references: Schema.Array(Reference),
  docs: Schema.Record(Schema.String, Schema.String),
  doc: ItemDoc,
  history: HistoryDoc,
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

export interface EditInput extends ModelSettings {
  body: string;
  media?: string;
  timecode?: number;
  end?: number;
  region?: Region;
  attachments?: ReadonlyArray<string>;
  variants?: number;
  agent: AgentChoice;
}

export interface NewFeedback {
  body: string;
  media?: string;
  timecode?: number;
  attachments?: ReadonlyArray<string>;
}

export interface NewItem {
  title: string;
  format?: string;
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
  uploadMedia: (id: string, file: File) => {
    const form = new FormData();
    form.set("file", file);

    return request(ItemDetail, `/api/item/media${q(id)}`, { method: "POST", body: form });
  },
  uploadReferences: (id: string, uploads: ReadonlyArray<Upload>) =>
    request(Added, `/api/item/references${q(id)}`, { method: "POST", body: uploadForm(uploads) }),
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
  continueEdits: (id: string) => send(Ok, "POST", `/api/item/edit/continue${q(id)}`, {}),
  cancelWaiting: (id: string, feedbackId?: string) =>
    send(
      ItemDetail,
      "POST",
      `/api/item/edit/cancel${q(id)}`,
      feedbackId === undefined ? {} : { feedbackId },
    ),
  rewordWaiting: (id: string, feedbackId: string, body: string) =>
    send(ItemDetail, "POST", `/api/item/edit/reword${q(id)}`, { feedbackId, body }),
  stopEdit: (id: string) => send(Ok, "POST", `/api/item/edit/stop${q(id)}`, {}),
  editPrompt: (id: string, feedbackId: string) =>
    request(Prompt, `/api/item/edit/prompt${q(id)}&feedbackId=${encodeURIComponent(feedbackId)}`),
  approveEdit: (id: string, feedbackId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/approve${q(id)}`, { feedbackId }),
  pickVariant: (id: string, feedbackId: string, variantId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/pick${q(id)}`, { feedbackId, variantId }),
  restoreEdit: (id: string, feedbackId: string) =>
    send(ItemDetail, "POST", `/api/item/edit/restore${q(id)}`, { feedbackId }),
  undo: (id: string) => send(ItemDetail, "POST", `/api/item/history/undo${q(id)}`, {}),
  redo: (id: string) => send(ItemDetail, "POST", `/api/item/history/redo${q(id)}`, {}),
  goTo: (id: string, entryId: string | undefined) =>
    send(
      ItemDetail,
      "POST",
      `/api/item/history/goto${q(id)}`,
      entryId === undefined ? {} : { entryId },
    ),
  restoreVersion: (id: string, versionId: string) =>
    send(ItemDetail, "POST", `/api/item/history/version${q(id)}`, { versionId }),
  verify: (id: string) => request(Schema.Array(MediaReport), `/api/item/verify${q(id)}`),
  feedback: () => request(Schema.Array(OpenFeedback), "/api/feedback"),
};
