import { watch } from "node:fs";
import { extname, join } from "node:path";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import {
  addFeedback,
  getItem,
  listItems,
  openFeedback,
  resolveFeedback,
  updateItem,
} from "../core/items.ts";
import { getFormat, getProduct, listFormats } from "../core/library.ts";
import {
  addReference,
  getReference,
  listReferences,
  preprocessReference,
} from "../core/references.ts";
import { ItemStatus } from "../core/schema.ts";
import { verifyItem } from "../core/verify.ts";
import type { Workspace } from "../core/workspace.ts";

const SERVABLE = new Set([
  ".mp4",
  ".mov",
  ".webm",
  ".m4v",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".md",
  ".json",
  ".srt",
  ".vtt",
  ".wav",
  ".mp3",
  ".m4a",
]);
const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".md": "text/markdown; charset=utf-8",
  ".srt": "text/plain; charset=utf-8",
  ".vtt": "text/vtt",
};

export function createApp(ws: Workspace, opts: { webDir?: string } = {}): Hono {
  const app = new Hono();
  const changes = createChangeFeed(ws.root);

  app.onError((err, c) => c.json({ error: err.message }, 400));

  app.get("/api/workspace", async (c) => {
    const [product, formats, feedback] = await Promise.all([
      getProduct(ws),
      listFormats(ws),
      openFeedback(ws),
    ]);
    return c.json({
      name: ws.config.name,
      root: ws.root,
      config: ws.config,
      product,
      formats,
      openFeedback: feedback.length,
    });
  });

  app.get("/api/items", async (c) => {
    const items = await listItems(ws);
    return c.json(
      items.map((i) => ({
        id: i.id,
        dir: i.dir,
        legacy: i.legacy,
        title: i.doc.title,
        status: i.doc.status,
        format: i.doc.format,
        hook: i.doc.hook,
        schedule: i.doc.schedule,
        openFeedback: i.doc.feedback.filter((f) => f.status === "open").length,
        media: i.media,
        updatedAt: i.updatedAt,
      })),
    );
  });

  app.get("/api/item", async (c) => {
    const item = await getItem(ws, required(c.req.query("id")));
    const docs: Record<string, string> = {};
    for (const name of item.docs) docs[name] = await ws.readText(`${item.dir}/${name}`);
    return c.json({ ...item, docs });
  });

  app.patch("/api/item", async (c) => {
    const body = await c.req.json<{
      status?: string;
      title?: string;
      caption?: string;
      hook?: string;
      notes?: string;
    }>();
    const patch: Parameters<typeof updateItem>[2] = {};
    if (body.status) patch.status = ItemStatus.parse(body.status);
    if (body.title !== undefined) patch.title = body.title;
    if (body.caption !== undefined) patch.caption = body.caption;
    if (body.hook !== undefined) patch.hook = body.hook;
    if (body.notes !== undefined) patch.notes = body.notes;
    return c.json(await updateItem(ws, required(c.req.query("id")), patch));
  });

  app.post("/api/item/feedback", async (c) => {
    const body = await c.req.json<{ body: string; media?: string; timecode?: number }>();
    if (!body.body?.trim()) throw new Error("Feedback body is empty");
    const input: Parameters<typeof addFeedback>[2] = { body: body.body.trim() };
    if (body.media) input.media = body.media;
    if (typeof body.timecode === "number") input.timecode = body.timecode;
    return c.json(await addFeedback(ws, required(c.req.query("id")), input));
  });

  app.post("/api/item/feedback/resolve", async (c) => {
    const body = await c.req.json<{ feedbackId: string; resolution?: string }>();
    return c.json(
      await resolveFeedback(
        ws,
        required(c.req.query("id")),
        body.feedbackId,
        body.resolution ?? "Resolved in the web UI",
      ),
    );
  });

  app.get("/api/item/verify", async (c) =>
    c.json(await verifyItem(ws, required(c.req.query("id")))),
  );

  app.get("/api/feedback", async (c) => c.json(await openFeedback(ws)));

  app.get("/api/references", async (c) => c.json(await listReferences(ws)));
  app.get("/api/reference", async (c) =>
    c.json(await getReference(ws, required(c.req.query("id")))),
  );
  app.post("/api/reference/preprocess", async (c) =>
    c.json(await preprocessReference(ws, required(c.req.query("id")))),
  );

  app.post("/api/references", async (c) => {
    const type = c.req.header("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new Error("Missing file");
      const title = form.get("title");
      const ref = await addReference(
        ws,
        { kind: "bytes", name: file.name, bytes: await file.arrayBuffer() },
        typeof title === "string" && title ? { title } : {},
      );
      return c.json(ref);
    }
    const body = await c.req.json<{ url: string; title?: string }>();
    return c.json(
      await addReference(
        ws,
        { kind: "url", url: required(body.url) },
        body.title ? { title: body.title } : {},
      ),
    );
  });

  app.get("/api/formats", async (c) => c.json(await listFormats(ws)));
  app.get("/api/format", async (c) => c.json(await getFormat(ws, required(c.req.query("id")))));

  app.get("/api/events", (c) =>
    streamSSE(c, async (stream) => {
      const unsubscribe = changes.subscribe(
        (path) => void stream.writeSSE({ event: "change", data: path }),
      );
      stream.onAbort(unsubscribe);
      while (!stream.aborted) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(25_000);
      }
    }),
  );

  /** Workspace files (media, docs) with byte-range support for video scrubbing. */
  app.get("/files/*", (c) => {
    const rel = decodeURIComponent(c.req.path.slice("/files/".length));
    const ext = extname(rel).toLowerCase();
    if (!SERVABLE.has(ext)) return c.text("Not servable", 403);
    const file = Bun.file(ws.abs(rel));
    const size = file.size;
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "cache-control": "no-cache",
    };
    const mime = MIME[ext] ?? file.type;
    headers["content-type"] = mime;
    const range = c.req.header("range");
    const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    if (match) {
      const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      headers["content-range"] = `bytes ${start}-${end}/${size}`;
      headers["content-length"] = String(end - start + 1);
      return new Response(file.slice(start, end + 1), { status: 206, headers });
    }
    headers["content-length"] = String(size);
    return new Response(file, { headers });
  });

  if (opts.webDir) {
    const webDir = opts.webDir;
    app.get("*", async (c) => {
      const asset = Bun.file(join(webDir, c.req.path));
      if (c.req.path !== "/" && (await asset.exists())) return new Response(asset);
      return new Response(Bun.file(join(webDir, "index.html")));
    });
  }

  return app;
}

function required(value: string | undefined): string {
  if (!value) throw new Error("Missing required parameter");
  return value;
}

const IGNORED = /(^|\/)(node_modules|\.git|dist|\.factory)(\/|$)/;

/** Debounced recursive watch so agent writes show up in the browser without a refresh. */
function createChangeFeed(root: string) {
  const listeners = new Set<(path: string) => void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = "";
  watch(root, { recursive: true }, (_event, filename) => {
    const path = filename?.toString() ?? "";
    if (IGNORED.test(path)) return;
    pending = path;
    clearTimeout(timer);
    timer = setTimeout(() => listeners.forEach((l) => l(pending)), 300);
  });
  return {
    subscribe(listener: (path: string) => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}
