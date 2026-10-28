import { Effect, Option, Schema } from "effect";
import { Toolkit } from "effect/ai";

import { awaitsDecision } from "../core/editVariants.ts";
import { updateDetails } from "../core/history.ts";
import { getItem, listItems } from "../core/items.ts";
import { itemReferences, listReferences } from "../core/references.ts";
import { Aspect, ItemDoc, ItemPatch, ItemStatus } from "../core/schema.ts";
import { Workspace } from "../core/workspace.ts";
import { createCountedItem, freeVersionNote, planStatus, workOn } from "../plan.ts";
import {
  AbsDir,
  AwaitingDecision,
  Created,
  FreeVersion,
  Id,
  describe,
  tool,
  toolRunner,
} from "./tool.ts";

/** How long a markdown doc in get_item may be before it is cut. */
const DOC_PREVIEW_CHARS = 8000;

const MediaFile = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["video", "image"]),
  aspect: Schema.optional(Aspect),
  size: Schema.Finite.annotate(describe("bytes")),
  mtime: Schema.Finite.annotate(describe("epoch milliseconds")),
});

const ReferenceFile = Schema.Struct({
  path: Schema.String.annotate(
    describe("relative to the item folder, such as references/logo.png"),
  ),
  name: Schema.String,
  dir: Schema.Boolean,
  files: Schema.optional(
    Schema.Finite.annotate(describe("for a folder: files in it, all the way down")),
  ),
  size: Schema.Finite.annotate(describe("bytes; for a folder, of everything in it")),
  mtime: Schema.Finite.annotate(describe("epoch milliseconds")),
  kind: Schema.optional(Schema.Literals(["video", "image"])),
});

const ItemSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: ItemStatus,
  format: Schema.optional(Schema.String),
  media: Schema.Finite.annotate(describe("media file count")),
  openFeedback: Schema.Finite,
  awaitingDecision: AwaitingDecision,
});

const ItemDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  doc: ItemDoc,
  media: Schema.Array(MediaFile),
  references: Schema.Array(ReferenceFile).annotate(
    describe(
      "files and folders the user gave this item to work from; read them, never change them",
    ),
  ),
  docs: Schema.Record(Schema.String, Schema.String).annotate(
    describe(`markdown files in the folder by name, cut at ${DOC_PREVIEW_CHARS} characters`),
  ),
  updatedAt: Schema.Finite,
});

const ListItems = tool("list_items", {
  description: "List content items, optionally filtered by status or format.",
  parameters: Schema.Struct({
    status: Schema.optional(ItemStatus),
    format: Schema.optional(Schema.String),
  }),
  success: Schema.Struct({ items: Schema.Array(ItemSummary) }),
  readonly: true,
});

const GetItem = tool("get_item", {
  description:
    "Full item: item.yaml fields, media files, the user's reference files, absolute folder path, and any markdown docs.",
  parameters: Schema.Struct({ id: Id }),
  success: ItemDetail,
  readonly: true,
});

const CreateItem = tool("create_item", {
  description:
    "Create a content item folder with item.yaml, or bring in a folder that already holds content by passing its `id`. Returns its id and absolute folder for writing media.",
  parameters: Schema.Struct({
    title: Schema.String,
    format: Schema.optional(Schema.String),
    hook: Schema.optional(Schema.String),
    notes: Schema.optional(Schema.String),
    inputs: Schema.optional(
      Schema.Record(Schema.String, Schema.String).annotate(
        describe(
          "values for the format's inputs by input id (see get_format); defaults fill the rest",
        ),
      ),
    ),
    id: Schema.optional(
      Schema.String.annotate(
        describe(
          "explicit folder id; defaults to <format>/<slug>. An existing folder without item.yaml becomes the item as is",
        ),
      ),
    ),
  }),
  success: Schema.Struct({ ...Created.fields, freeVersion: FreeVersion }),
});

const UpdateItem = tool("update_item", {
  description:
    "Patch item fields. `sources` replaces the item's list of folders, files, and web pages that agents read when they work on it.",
  parameters: Schema.Struct({ id: Id, ...ItemPatch.fields }),
  success: Schema.Struct({
    id: Schema.String,
    status: ItemStatus,
    updated: Schema.optional(Schema.String),
  }),
  overwrites: true,
  idempotent: true,
});

export const ItemsToolkit = Toolkit.make(ListItems, GetItem, CreateItem, UpdateItem);

export const itemsHandlers = ItemsToolkit.toLayer(
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const run = yield* toolRunner;

    return ItemsToolkit.of({
      list_items: ({ status, format }) =>
        run(
          Effect.map(listItems(), (items) => ({
            items: items
              .filter(
                (item) =>
                  (status === undefined || item.doc.status === status) &&
                  (format === undefined || item.doc.format === format),
              )
              .map((item) => ({
                id: item.id,
                title: item.doc.title,
                status: item.doc.status,
                format: item.doc.format,
                media: item.media.length,
                openFeedback: item.doc.feedback.filter((f) => f.status === "open").length,
                awaitingDecision: item.doc.feedback.filter(awaitsDecision).length,
              })),
          })),
        ),

      get_item: ({ id }) =>
        run(
          Effect.gen(function* () {
            const item = yield* getItem(id);

            const docs = yield* Effect.forEach(item.docs, (name) =>
              Effect.map(ws.readText(`${item.dir}/${name}`), (text): readonly [string, string] => [
                name,
                text.slice(0, DOC_PREVIEW_CHARS),
              ]),
            );

            return {
              ...item,
              absDir: yield* ws.abs(item.dir),
              references: yield* listReferences(itemReferences(item)),
              docs: Object.fromEntries(docs),
            };
          }),
        ),

      create_item: (input) =>
        run(
          Effect.gen(function* () {
            const item = yield* createCountedItem(input);

            return {
              id: item.id,
              absDir: yield* ws.abs(item.dir),
              freeVersion: Option.getOrUndefined(freeVersionNote(yield* planStatus())),
            };
          }),
        ),

      update_item: ({ id, ...patch }) =>
        run(
          Effect.map(Effect.andThen(workOn(id), updateDetails(id, patch)), (item) => ({
            id: item.id,
            status: item.doc.status,
            updated: item.doc.updated,
          })),
        ),
    });
  }),
);
