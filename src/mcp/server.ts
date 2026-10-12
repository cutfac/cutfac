import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createItem,
  getItem,
  listItems,
  openFeedback,
  recordMetrics,
  resolveFeedback,
  updateItem,
  upsertSchedule,
} from "../core/items.ts";
import { getFormat, getProduct, listFormats, saveFormat } from "../core/library.ts";
import {
  addReference,
  getReference,
  listReferences,
  preprocessReference,
  saveAnalysis,
} from "../core/references.ts";
import {
  FormatDoc,
  ItemStatus,
  MetricsEntry,
  Platform,
  PlatformCopy,
  ScheduleEntry,
} from "../core/schema.ts";
import { importProduct } from "../core/productImport.ts";
import { verifyItem } from "../core/verify.ts";
import type { Workspace } from "../core/workspace.ts";

const json = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
});

/** Transport-agnostic tool registration; stdio today, HTTP for a hosted workspace later. */
export function createMcpServer(ws: Workspace): McpServer {
  const server = new McpServer(
    { name: "content-factory", version: "0.1.0" },
    {
      instructions:
        "Content Factory workspace tools. Start with workspace_overview. Items, references, and formats are folders on disk; " +
        "write media into an item's absDir with [9x16]-style filename prefixes, then call verify_item. " +
        "Always read the product (get_product) before writing copy. Resolve each open feedback entry after addressing it.",
    },
  );
  const tool = server.registerTool.bind(server);

  tool(
    "workspace_overview",
    {
      description:
        "Workspace config, product summary, item counts by status, formats, and open feedback count.",
    },
    async () => {
      const [items, formats, product, feedback, refs] = await Promise.all([
        listItems(ws),
        listFormats(ws),
        getProduct(ws),
        openFeedback(ws),
        listReferences(ws),
      ]);
      const byStatus: Record<string, number> = {};
      for (const i of items) byStatus[i.doc.status] = (byStatus[i.doc.status] ?? 0) + 1;
      return json({
        root: ws.root,
        config: ws.config,
        product: product.doc ?? "missing: create product/product.yaml",
        items: byStatus,
        formats: formats.map((f) => ({ id: f.id, title: f.doc.title })),
        references: refs.length,
        openFeedback: feedback.length,
      });
    },
  );

  tool(
    "get_product",
    {
      description:
        "The user's app: positioning, audience, store links, CTA rules, brand, and reviewed app captures.",
    },
    async () => {
      const product = await getProduct(ws);
      return json({ ...product, capturesDir: ws.abs(`${ws.config.paths.product}/captures`) });
    },
  );

  tool(
    "import_product",
    {
      description:
        "Fill product.yaml from an App Store, Google Play, or landing page URL (store links on a landing page are followed) " +
        "and download store screenshots into product/store/. Hand-edited fields are kept. Afterwards, read product/store/listing.md " +
        "and refine oneLiner and audience with the user.",
      inputSchema: { url: z.string().url() },
    },
    async ({ url }) => {
      const result = await importProduct(ws, url);
      return json({
        product: result.product,
        files: result.files,
        warnings: result.warnings,
        sources: result.listings.map((l) => ({ source: l.source, url: l.url, name: l.name })),
      });
    },
  );

  tool(
    "list_items",
    {
      description: "List content items, optionally filtered by status or format.",
      inputSchema: { status: ItemStatus.optional(), format: z.string().optional() },
    },
    async ({ status, format }) => {
      const items = await listItems(ws);
      return json(
        items
          .filter(
            (i) => (!status || i.doc.status === status) && (!format || i.doc.format === format),
          )
          .map((i) => ({
            id: i.id,
            title: i.doc.title,
            status: i.doc.status,
            format: i.doc.format,
            media: i.media.length,
            openFeedback: i.doc.feedback.filter((f) => f.status === "open").length,
          })),
      );
    },
  );

  tool(
    "get_item",
    {
      description:
        "Full item: item.yaml fields, media files, absolute folder path, and any markdown docs.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const item = await getItem(ws, id);
      const docs: Record<string, string> = {};
      for (const name of item.docs)
        docs[name] = (await ws.readText(`${item.dir}/${name}`)).slice(0, 8000);
      return json({ ...item, absDir: ws.abs(item.dir), docs });
    },
  );

  tool(
    "create_item",
    {
      description:
        "Create a content item folder with item.yaml. Returns its id and absolute folder for writing media.",
      inputSchema: {
        title: z.string(),
        format: z.string().optional(),
        reference: z.string().optional(),
        hook: z.string().optional(),
        notes: z.string().optional(),
        id: z.string().optional().describe("explicit folder id; defaults to <format>/<slug>"),
      },
    },
    async (input) => {
      const item = await createItem(ws, stripUndefined(input));
      return json({ id: item.id, absDir: ws.abs(item.dir) });
    },
  );

  tool(
    "update_item",
    {
      description: "Patch item fields. Platform copy is merged per platform.",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        status: ItemStatus.optional(),
        format: z.string().optional(),
        reference: z.string().optional(),
        hook: z.string().optional(),
        caption: z.string().optional(),
        notes: z.string().optional(),
        platforms: z.partialRecord(Platform, PlatformCopy).optional(),
      },
    },
    async ({ id, ...patch }) => {
      const item = await updateItem(ws, id, stripUndefined(patch));
      return json({ id: item.id, status: item.doc.status, updated: item.doc.updated });
    },
  );

  tool(
    "verify_item",
    {
      description:
        "ffprobe each video in the item and check codec, aspect, resolution, audio, stream start, and format rules.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => json(await verifyItem(ws, id)),
  );

  tool(
    "list_open_feedback",
    { description: "All unresolved review comments the user left in the web UI, across items." },
    async () => json(await openFeedback(ws)),
  );

  tool(
    "resolve_feedback",
    {
      description: "Mark a review comment as handled and describe what changed.",
      inputSchema: { item: z.string(), feedbackId: z.string(), resolution: z.string() },
    },
    async ({ item, feedbackId, resolution }) => {
      await resolveFeedback(ws, item, feedbackId, resolution);
      return json({ ok: true });
    },
  );

  tool(
    "set_schedule",
    {
      description:
        "Record a planned, scheduled, or published post for one platform (e.g. after scheduling through Postiz).",
      inputSchema: { id: z.string(), ...ScheduleEntry.shape },
    },
    async ({ id, ...entry }) => {
      const item = await upsertSchedule(ws, id, ScheduleEntry.parse(entry));
      return json({ status: item.doc.status, schedule: item.doc.schedule });
    },
  );

  tool(
    "record_metrics",
    {
      description: "Append a metrics snapshot for a published item.",
      inputSchema: { id: z.string(), ...MetricsEntry.shape },
    },
    async ({ id, ...entry }) => {
      const item = await recordMetrics(ws, id, MetricsEntry.parse(entry));
      return json({ metrics: item.doc.metrics.length });
    },
  );

  tool(
    "list_references",
    { description: "Reference videos with title, source, probe, and whether an analysis exists." },
    async () =>
      json(
        (await listReferences(ws)).map((r) => ({
          id: r.id,
          title: r.doc.title,
          source: r.doc.source,
          duration: r.doc.probe?.duration,
          analyzed: Boolean(r.analysis),
        })),
      ),
  );

  tool(
    "add_reference",
    {
      description:
        "Add a reference video from a local file path or a URL (downloaded with yt-dlp), then extract cuts, frames, a contact sheet, and audio.",
      inputSchema: {
        source: z.string().describe("absolute file path or http(s) URL"),
        title: z.string().optional(),
        tags: z.array(z.string()).optional(),
      },
    },
    async ({ source, title, tags }) => {
      const src = /^https?:\/\//.test(source)
        ? { kind: "url" as const, url: source }
        : { kind: "file" as const, path: source };
      const ref = await addReference(ws, src, stripUndefined({ title, tags }));
      return json({ id: ref.id, absDir: ws.abs(ref.dir), preprocess: ref.preprocess });
    },
  );

  tool(
    "get_reference",
    {
      description:
        "Reference metadata, preprocessing output (cut times, frame files, contact sheet), existing analysis, and absolute folder. Look at the contact sheet and hook frames before analyzing.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const ref = await getReference(ws, id);
      return json({ ...ref, absDir: ws.abs(ref.dir) });
    },
  );

  tool(
    "preprocess_reference",
    {
      description: "Re-run deterministic preprocessing for a reference.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => json(await preprocessReference(ws, id)),
  );

  tool(
    "save_reference_analysis",
    {
      description:
        "Save your markdown analysis of a reference: hook (first 3s), structure beats with timestamps, pacing, text overlays, audio, CTA, and what to reuse.",
      inputSchema: { id: z.string(), markdown: z.string() },
    },
    async ({ id, markdown }) => {
      await saveAnalysis(ws, id, markdown);
      return json({ ok: true });
    },
  );

  tool("list_formats", { description: "Reusable format recipes." }, async () =>
    json((await listFormats(ws)).map((f) => ({ id: f.id, ...f.doc }))),
  );

  tool(
    "get_format",
    {
      description: "One format recipe with its README and absolute folder (templates live there).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const f = await getFormat(ws, id);
      return json({ ...f, absDir: ws.abs(f.dir) });
    },
  );

  tool(
    "save_format",
    {
      description: "Create or replace a format recipe distilled from one or more references.",
      inputSchema: { id: z.string().optional(), ...FormatDoc.shape },
    },
    async (input) => {
      const f = await saveFormat(ws, FormatDoc.extend({ id: z.string().optional() }).parse(input));
      return json({ id: f.id, absDir: ws.abs(f.dir) });
    },
  );

  return server;
}

function stripUndefined<T extends object>(value: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]: Exclude<T[K], undefined>;
  };
}

export async function runStdio(ws: Workspace): Promise<void> {
  await createMcpServer(ws).connect(new StdioServerTransport());
}
