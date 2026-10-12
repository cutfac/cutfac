import { type Crypto, Effect, type FileSystem, Layer, Logger, type Path, Schema } from "effect";
import { McpProtocol, McpServer, Tool, Toolkit } from "effect/ai";
import type { HttpClient } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import { resolveEdit } from "../core/edits.ts";
import {
  CommandFailed,
  Conflict,
  FetchFailed,
  InvalidRequest,
  NotFound,
  WorkspaceError,
} from "../core/errors.ts";
import { updateDetails } from "../core/history.ts";
import {
  createItem,
  getItem,
  listItems,
  openFeedback,
  recordMetrics,
  upsertSchedule,
} from "../core/items.ts";
import { getFormat, getProduct, listFormats, saveFormat } from "../core/library.ts";
import { importProduct } from "../core/productImport.ts";
import {
  addReference,
  getReference,
  listReferences,
  preprocessReference,
  referenceSourceOf,
  saveAnalysis,
} from "../core/references.ts";
import {
  Aspect,
  Feedback,
  FormatDoc,
  ItemDoc,
  ItemPatch,
  ItemStatus,
  MetricsEntry,
  PreprocessResult,
  Product,
  ReferenceDoc,
  ScheduleEntry,
  WorkspaceConfig,
} from "../core/schema.ts";
import { verifyItem } from "../core/verify.ts";
import { Workspace } from "../core/workspace.ts";

export const MCP_NAME = "content-factory";

export const MCP_VERSION = "0.1.0";

const INSTRUCTIONS =
  "Content Factory workspace tools. Start with workspace_overview. Items, references, and formats are folders on disk; " +
  "write media into an item's absDir with [9x16]-style filename prefixes, then call verify_item. " +
  "Always read the product (get_product) before writing copy. Resolve each open feedback entry after addressing it.";

/** How long a markdown doc in get_item may be before it is cut. */
const DOC_PREVIEW_CHARS = 8000;

const describe = (description: string) => ({ description });

/** Every error the core raises. Each carries a message, which the agent sees as the tool error. */
const FactoryFailure = Schema.Union([
  WorkspaceError,
  NotFound,
  InvalidRequest,
  Conflict,
  CommandFailed,
  FetchFailed,
]);

const Id = Schema.String.annotate(describe("item id, such as hooks/first-try"));

const Ok = Schema.Struct({ ok: Schema.Literal(true) });

const MediaFile = Schema.Struct({
  name: Schema.String,
  kind: Schema.Literals(["video", "image"]),
  aspect: Schema.optional(Aspect),
  size: Schema.Finite.annotate(describe("bytes")),
  mtime: Schema.Finite.annotate(describe("epoch milliseconds")),
});

const AbsDir = Schema.String.annotate(describe("absolute folder; read and write files here"));

const Created = Schema.Struct({ id: Schema.String, absDir: AbsDir });

const ItemSummary = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  status: ItemStatus,
  format: Schema.optional(Schema.String),
  media: Schema.Finite.annotate(describe("media file count")),
  openFeedback: Schema.Finite,
});

const ItemDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  legacy: Schema.Boolean,
  doc: ItemDoc,
  media: Schema.Array(MediaFile),
  docs: Schema.Record(Schema.String, Schema.String).annotate(
    describe(`markdown files in the folder by name, cut at ${DOC_PREVIEW_CHARS} characters`),
  ),
  updatedAt: Schema.Finite,
});

const OpenFeedbackEntry = Schema.Struct({
  item: Schema.String,
  title: Schema.String,
  absDir: AbsDir,
  feedback: Feedback,
});

const Check = Schema.Struct({ name: Schema.String, ok: Schema.Boolean, detail: Schema.String });

const ReferenceDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  doc: ReferenceDoc,
  analysis: Schema.optional(Schema.String),
  preprocess: Schema.optional(PreprocessResult),
});

const FormatDetail = Schema.Struct({
  id: Schema.String,
  dir: Schema.String,
  absDir: AbsDir,
  doc: FormatDoc,
  readme: Schema.optional(Schema.String),
});

const ById = Schema.Struct({ id: Schema.String });

const tool = <
  const Name extends string,
  Parameters extends Schema.Constraint = typeof Tool.EmptyParams,
  Success extends Schema.Constraint = typeof Schema.Void,
>(
  name: Name,
  options: {
    readonly description: string;
    readonly parameters?: Parameters | undefined;
    readonly success: Success;
    /** Only reads the workspace. */
    readonly readonly?: boolean | undefined;
    /** Replaces something the agent or user wrote before, rather than adding to it. */
    readonly overwrites?: boolean | undefined;
    /** Calling it again with the same arguments changes nothing further. */
    readonly idempotent?: boolean | undefined;
    /** Reaches the network (store listings, yt-dlp downloads). */
    readonly network?: boolean | undefined;
  },
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: options.success,
    failure: FactoryFailure,
  })
    .annotate(Tool.Readonly, options.readonly === true)
    .annotate(Tool.Destructive, options.overwrites === true)
    .annotate(Tool.Idempotent, options.readonly === true || options.idempotent === true)
    .annotate(Tool.OpenWorld, options.network === true);

const WorkspaceOverview = tool("workspace_overview", {
  description:
    "Workspace config, product summary, item counts by status, formats, and open feedback count.",
  success: Schema.Struct({
    root: Schema.String,
    config: WorkspaceConfig,
    product: Schema.NullOr(Product).annotate(
      describe("null until product/product.yaml exists; fill it with import_product"),
    ),
    items: Schema.Record(Schema.String, Schema.Finite).annotate(describe("item count by status")),
    formats: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
    references: Schema.Finite,
    openFeedback: Schema.Finite,
  }),
  readonly: true,
});

const GetProduct = tool("get_product", {
  description:
    "The user's app: positioning, audience, store links, CTA rules, brand, and reviewed app captures.",
  success: Schema.Struct({
    doc: Schema.optional(Product),
    captures: Schema.Array(MediaFile),
    store: Schema.Array(MediaFile),
    notes: Schema.optional(Schema.String),
    capturesDir: AbsDir,
    storeDir: AbsDir,
  }),
  readonly: true,
});

const ImportProduct = tool("import_product", {
  description:
    "Fill product.yaml from an App Store, Google Play, or landing page URL (store links on a landing page are followed) " +
    "and download store screenshots into product/store/. Hand-edited fields are kept. Afterwards, read product/store/listing.md " +
    "and refine oneLiner and audience with the user.",
  parameters: Schema.Struct({ url: Schema.String.annotate(describe("http(s) URL")) }),
  success: Schema.Struct({
    product: Product,
    files: Schema.Array(Schema.String),
    warnings: Schema.Array(Schema.String),
    sources: Schema.Array(
      Schema.Struct({
        source: Schema.Literals(["appStore", "googlePlay", "web"]),
        url: Schema.String,
        name: Schema.String,
      }),
    ),
  }),
  overwrites: true,
  network: true,
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
    "Full item: item.yaml fields, media files, absolute folder path, and any markdown docs.",
  parameters: Schema.Struct({ id: Id }),
  success: ItemDetail,
  readonly: true,
});

const CreateItem = tool("create_item", {
  description:
    "Create a content item folder with item.yaml. Returns its id and absolute folder for writing media.",
  parameters: Schema.Struct({
    title: Schema.String,
    format: Schema.optional(Schema.String),
    reference: Schema.optional(Schema.String),
    hook: Schema.optional(Schema.String),
    notes: Schema.optional(Schema.String),
    id: Schema.optional(
      Schema.String.annotate(describe("explicit folder id; defaults to <format>/<slug>")),
    ),
  }),
  success: Created,
});

const UpdateItem = tool("update_item", {
  description: "Patch item fields. Platform copy is merged per platform.",
  parameters: Schema.Struct({ id: Id, ...ItemPatch.fields }),
  success: Schema.Struct({
    id: Schema.String,
    status: ItemStatus,
    updated: Schema.optional(Schema.String),
  }),
  overwrites: true,
  idempotent: true,
});

const VerifyItem = tool("verify_item", {
  description:
    "ffprobe each video in the item and check codec, aspect, resolution, audio, stream start, and format rules.",
  parameters: Schema.Struct({ id: Id }),
  success: Schema.Struct({
    ok: Schema.Boolean.annotate(describe("every check on every video passed")),
    media: Schema.Array(
      Schema.Struct({ file: Schema.String, ok: Schema.Boolean, checks: Schema.Array(Check) }),
    ),
  }),
  readonly: true,
});

const ListOpenFeedback = tool("list_open_feedback", {
  description:
    "All unresolved edit requests the user left on the board, across items. Each can target a time range " +
    "(timecode → end, seconds) and a region (x, y, w, h as fractions of the frame at `at` seconds). " +
    "context holds item-relative files prepared for you: clip (the range), frame (red box = region), before (saved copy).",
  success: Schema.Struct({ feedback: Schema.Array(OpenFeedbackEntry) }),
  readonly: true,
});

const ResolveFeedback = tool("resolve_feedback", {
  description:
    "Mark an edit request as handled and describe what changed. Call it after writing the edited media; " +
    "the edited file is saved as the 'after' version the user compares and approves.",
  parameters: Schema.Struct({ item: Id, feedbackId: Schema.String, resolution: Schema.String }),
  success: Ok,
});

const SetSchedule = tool("set_schedule", {
  description:
    "Record a planned, scheduled, or published post for one platform (e.g. after scheduling through Postiz).",
  parameters: Schema.Struct({ id: Id, ...ScheduleEntry.fields }),
  success: Schema.Struct({ status: ItemStatus, schedule: Schema.Array(ScheduleEntry) }),
  overwrites: true,
  idempotent: true,
});

const RecordMetrics = tool("record_metrics", {
  description: "Append a metrics snapshot for a published item.",
  parameters: Schema.Struct({ id: Id, ...MetricsEntry.fields }),
  success: Schema.Struct({
    metrics: Schema.Finite.annotate(describe("snapshots recorded so far")),
  }),
});

const ListReferences = tool("list_references", {
  description: "Reference videos with title, source, probe, and whether an analysis exists.",
  success: Schema.Struct({
    references: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        source: Schema.optional(Schema.String),
        duration: Schema.optional(Schema.Finite),
        analyzed: Schema.Boolean,
      }),
    ),
  }),
  readonly: true,
});

const AddReference = tool("add_reference", {
  description:
    "Add a reference video from a local file path or a URL (downloaded with yt-dlp), then extract cuts, frames, a contact sheet, and audio.",
  parameters: Schema.Struct({
    source: Schema.String.annotate(describe("absolute file path or http(s) URL")),
    title: Schema.optional(Schema.String),
    tags: Schema.optional(Schema.Array(Schema.String)),
  }),
  success: Schema.Struct({
    id: Schema.String,
    absDir: AbsDir,
    preprocess: Schema.optional(PreprocessResult),
  }),
  network: true,
});

const GetReference = tool("get_reference", {
  description:
    "Reference metadata, preprocessing output (cut times, frame files, contact sheet), existing analysis, and absolute folder. Look at the contact sheet and hook frames before analyzing.",
  parameters: ById,
  success: ReferenceDetail,
  readonly: true,
});

const PreprocessReference = tool("preprocess_reference", {
  description: "Re-run deterministic preprocessing for a reference.",
  parameters: ById,
  success: PreprocessResult,
  overwrites: true,
  idempotent: true,
});

const SaveReferenceAnalysis = tool("save_reference_analysis", {
  description:
    "Save your markdown analysis of a reference: hook (first 3s), structure beats with timestamps, pacing, text overlays, audio, CTA, and what to reuse.",
  parameters: Schema.Struct({ id: Schema.String, markdown: Schema.String }),
  success: Ok,
  overwrites: true,
  idempotent: true,
});

const ListFormats = tool("list_formats", {
  description: "Reusable format recipes.",
  success: Schema.Struct({
    formats: Schema.Array(Schema.Struct({ id: Schema.String, ...FormatDoc.fields })),
  }),
  readonly: true,
});

const GetFormat = tool("get_format", {
  description: "One format recipe with its README and absolute folder (templates live there).",
  parameters: ById,
  success: FormatDetail,
  readonly: true,
});

const SaveFormat = tool("save_format", {
  description: "Create or replace a format recipe distilled from one or more references.",
  parameters: Schema.Struct({ id: Schema.optional(Schema.String), ...FormatDoc.fields }),
  success: Created,
  overwrites: true,
});

export const FactoryToolkit = Toolkit.make(
  WorkspaceOverview,
  GetProduct,
  ImportProduct,
  ListItems,
  GetItem,
  CreateItem,
  UpdateItem,
  VerifyItem,
  ListOpenFeedback,
  ResolveFeedback,
  SetSchedule,
  RecordMetrics,
  ListReferences,
  AddReference,
  GetReference,
  PreprocessReference,
  SaveReferenceAnalysis,
  ListFormats,
  GetFormat,
  SaveFormat,
);

/** What the core needs to run a tool; captured once when the server starts. */
type ToolServices =
  | Workspace
  | Crypto.Crypto
  | FileSystem.FileSystem
  | Path.Path
  | HttpClient.HttpClient
  | ChildProcessSpawner.ChildProcessSpawner;

const countBy = <A>(values: ReadonlyArray<A>, key: (value: A) => string) => {
  const counts = new Map<string, number>();

  for (const value of values) counts.set(key(value), (counts.get(key(value)) ?? 0) + 1);

  return Object.fromEntries(counts);
};

const handlers = FactoryToolkit.toLayer(
  Effect.gen(function* () {
    const services = yield* Effect.context<ToolServices>();
    const ws = yield* Workspace;

    const run = <A, E>(effect: Effect.Effect<A, E, ToolServices>) =>
      Effect.provideContext(effect, services);

    const itemAbs = (id: string) => ws.abs(`${ws.config.paths.items}/${id}`);

    return FactoryToolkit.of({
      workspace_overview: () =>
        run(
          Effect.gen(function* () {
            const [items, formats, product, feedback, references] = yield* Effect.all(
              [listItems(), listFormats(), getProduct(), openFeedback(), listReferences()],
              { concurrency: "unbounded" },
            );

            return {
              root: ws.root,
              config: ws.config,
              product: product.doc ?? null,
              items: countBy(items, (item) => item.doc.status),
              formats: formats.map((format) => ({ id: format.id, title: format.doc.title })),
              references: references.length,
              openFeedback: feedback.length,
            };
          }),
        ),

      get_product: () =>
        run(
          Effect.gen(function* () {
            const product = yield* getProduct();

            return {
              ...product,
              capturesDir: yield* ws.abs(`${ws.config.paths.product}/captures`),
              storeDir: yield* ws.abs(`${ws.config.paths.product}/store`),
            };
          }),
        ),

      import_product: ({ url }) =>
        run(
          Effect.map(importProduct(url), (result) => ({
            product: result.product,
            files: result.files,
            warnings: result.warnings,
            sources: result.listings.map((l) => ({ source: l.source, url: l.url, name: l.name })),
          })),
        ),

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
              docs: Object.fromEntries(docs),
            };
          }),
        ),

      create_item: (input) =>
        run(
          Effect.gen(function* () {
            const item = yield* createItem(input);

            return { id: item.id, absDir: yield* ws.abs(item.dir) };
          }),
        ),

      update_item: ({ id, ...patch }) =>
        run(
          Effect.map(updateDetails(id, patch), (item) => ({
            id: item.id,
            status: item.doc.status,
            updated: item.doc.updated,
          })),
        ),

      verify_item: ({ id }) =>
        run(
          Effect.map(verifyItem(id), (media) => ({
            ok: media.every((report) => report.ok),
            media,
          })),
        ),

      list_open_feedback: () =>
        run(
          Effect.gen(function* () {
            const open = yield* openFeedback();

            const feedback = yield* Effect.forEach(open, (entry) =>
              Effect.map(itemAbs(entry.item), (absDir) => ({ ...entry, absDir })),
            );

            return { feedback };
          }),
        ),

      resolve_feedback: ({ item, feedbackId, resolution }) =>
        run(Effect.as(resolveEdit(item, feedbackId, resolution), { ok: true } as const)),

      set_schedule: ({ id, ...entry }) =>
        run(
          Effect.map(upsertSchedule(id, entry), (item) => ({
            status: item.doc.status,
            schedule: item.doc.schedule,
          })),
        ),

      record_metrics: ({ id, ...entry }) =>
        run(Effect.map(recordMetrics(id, entry), (item) => ({ metrics: item.doc.metrics.length }))),

      list_references: () =>
        run(
          Effect.map(listReferences(), (references) => ({
            references: references.map((reference) => ({
              id: reference.id,
              title: reference.doc.title,
              source: reference.doc.source,
              duration: reference.doc.probe?.duration,
              analyzed: reference.analysis !== undefined,
            })),
          })),
        ),

      add_reference: ({ source, title, tags }) =>
        run(
          Effect.gen(function* () {
            const reference = yield* addReference(referenceSourceOf(source), { title, tags });

            return {
              id: reference.id,
              absDir: yield* ws.abs(reference.dir),
              preprocess: reference.preprocess,
            };
          }),
        ),

      get_reference: ({ id }) =>
        run(
          Effect.gen(function* () {
            const reference = yield* getReference(id);

            return { ...reference, absDir: yield* ws.abs(reference.dir) };
          }),
        ),

      preprocess_reference: ({ id }) => run(preprocessReference(id)),

      save_reference_analysis: ({ id, markdown }) =>
        run(Effect.as(saveAnalysis(id, markdown), { ok: true } as const)),

      list_formats: () =>
        run(
          Effect.map(listFormats(), (formats) => ({
            formats: formats.map((format) => ({ id: format.id, ...format.doc })),
          })),
        ),

      get_format: ({ id }) =>
        run(
          Effect.gen(function* () {
            const format = yield* getFormat(id);

            return { ...format, absDir: yield* ws.abs(format.dir) };
          }),
        ),

      save_format: (input) =>
        run(
          Effect.gen(function* () {
            const format = yield* saveFormat(input);

            return { id: format.id, absDir: yield* ws.abs(format.dir) };
          }),
        ),
    });
  }),
);

/**
 * The workspace tools over stdio. Stdout carries the protocol, so logs go to stderr.
 * Needs the workspace, Stdio, and the platform services the core uses.
 */
export const mcpLayer = McpServer.toolkit(FactoryToolkit).pipe(
  Layer.provide(handlers),
  Layer.provide(
    McpServer.layerStdio({
      name: MCP_NAME,
      version: MCP_VERSION,
      instructions: INSTRUCTIONS,
      protocols: [
        McpProtocol.v2025_11_25,
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
    }),
  ),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true)),
);
