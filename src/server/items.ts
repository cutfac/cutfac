import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import type { Approval } from "../core/approval.ts";
import { awaitsDecision } from "../core/editVariants.ts";
import { readHistory } from "../core/history.ts";
import { type Item, getItem, importMedia, listItems } from "../core/items.ts";
import { addLinkedVideo } from "../core/linkedVideos.ts";
import {
  addReferences,
  itemReferences,
  listReferences,
  removeReference,
} from "../core/references.ts";
import { readRender } from "../core/render.ts";
import { listReviews } from "../core/review.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace } from "../core/workspace.ts";
import { createCountedItem, createEmptyItem } from "../plan.ts";
import { trackUsage } from "../usageStats.ts";
import { json, withId } from "./respond.ts";
import { MediaForm, ReferencesForm, uploadsOf } from "./uploads.ts";

const NewItemBody = Schema.Struct({
  title: Schema.String,
  format: Schema.optional(Schema.NonEmptyString),
  hook: Schema.optional(Schema.String),
  notes: Schema.optional(Schema.String),
  inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  /** Nothing is asked of it yet, so it counts as a video once work on it starts. */
  empty: Schema.optional(Schema.Boolean),
});

const ReferenceBody = Schema.Struct({ path: Schema.NonEmptyString });

/** A video link to download into an item's references. */
const LinkBody = Schema.Struct({ url: Schema.NonEmptyString });

/**
 * What the board shows for one item: the item, its markdown docs, its undo history, the agent's
 * last frame review of each video, its reference files, and whether an agent is on it.
 */
export const itemDetail = Effect.fn("server.itemDetail")(function* (item: Item) {
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

/** Files dropped, pasted or picked on the board, kept as the item's references. */
const addReferencesRoute = Effect.fn("server.addReferences")(function* (id: string) {
  const uploads = yield* uploadsOf(yield* HttpServerRequest.schemaBodyMultipart(ReferencesForm));
  const added = yield* addReferences(itemReferences(yield* getItem(id)), uploads);

  return { item: yield* itemDetail(yield* getItem(id)), added };
});

export const itemRoutes = HttpRouter.addAll([
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
    Effect.flatMap(HttpServerRequest.schemaBodyJson(NewItemBody), ({ empty, ...body }) =>
      (empty === true ? createEmptyItem(body) : createCountedItem(body)).pipe(
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
  json("GET", "/api/item/verify", withId(verifyItem)),
]);
