import { randomUUID } from "node:crypto";
import { type MediaFile, toMediaFiles } from "./media.ts";
import {
  type Feedback,
  ItemDoc,
  type ItemStatus,
  type MetricsEntry,
  type ScheduleEntry,
} from "./schema.ts";
import { type Workspace, nowIso, slugify } from "./workspace.ts";

export const ITEM_FILE = "item.yaml";
/** Folders that already hold one of these are items even without item.yaml (pre-factory layouts). */
const LEGACY_MARKERS = ["POSTING.md", "STATUS.md"];
const SKIP_DIRS = new Set(["node_modules", "review", "frames", "raw"]);

export interface Item {
  id: string;
  dir: string;
  legacy: boolean;
  doc: ItemDoc;
  media: MediaFile[];
  docs: string[];
  updatedAt: number;
}

const itemsRoot = (ws: Workspace) => ws.config.paths.items;
const itemDir = (ws: Workspace, id: string) => `${itemsRoot(ws)}/${id}`;

/**
 * Walk the items root; an item is any folder with item.yaml or a legacy marker file.
 * A legacy-marked folder that contains other items is a series (group), not an item.
 */
export async function listItemIds(ws: Workspace): Promise<string[]> {
  const ids: string[] = [];
  async function walk(rel: string, depth: number): Promise<void> {
    const entries = await ws.list(rel);
    const names = new Set(entries.map((e) => e.name));
    const isRoot = rel === itemsRoot(ws);
    if (!isRoot && names.has(ITEM_FILE)) {
      ids.push(rel.slice(itemsRoot(ws).length + 1));
      return;
    }
    const before = ids.length;
    if (depth <= 4) {
      for (const e of entries) {
        if (e.dir && !SKIP_DIRS.has(e.name)) await walk(`${rel}/${e.name}`, depth + 1);
      }
    }
    const hasChildItems = ids.length > before;
    if (!isRoot && !hasChildItems && LEGACY_MARKERS.some((m) => names.has(m))) {
      ids.push(rel.slice(itemsRoot(ws).length + 1));
    }
  }
  await walk(itemsRoot(ws), 0);
  return ids.sort();
}

export async function listItems(ws: Workspace): Promise<Item[]> {
  const ids = await listItemIds(ws);
  return Promise.all(ids.map((id) => getItem(ws, id)));
}

export async function getItem(ws: Workspace, id: string): Promise<Item> {
  const dir = itemDir(ws, id);
  if (!ws.exists(dir)) throw new Error(`Item not found: ${id}`);
  const entries = await ws.list(dir);
  const media = toMediaFiles(entries);
  const docs = entries.filter((e) => !e.dir && e.name.endsWith(".md")).map((e) => e.name);
  const updatedAt = Math.max(0, ...entries.map((e) => e.mtime));
  const legacy = !entries.some((e) => e.name === ITEM_FILE);
  const doc = legacy
    ? await deriveLegacyDoc(ws, id, docs, media)
    : await ws.readYaml(`${dir}/${ITEM_FILE}`, ItemDoc);
  return { id, dir, legacy, doc, media, docs, updatedAt };
}

async function deriveLegacyDoc(
  ws: Workspace,
  id: string,
  docs: string[],
  media: MediaFile[],
): Promise<ItemDoc> {
  const dir = itemDir(ws, id);
  const statusText = docs.includes("STATUS.md") ? await ws.readText(`${dir}/STATUS.md`) : "";
  const postingText = docs.includes("POSTING.md") ? await ws.readText(`${dir}/POSTING.md`) : "";
  const title =
    cleanTitle(firstHeading(postingText)) ??
    cleanTitle(firstHeading(statusText)) ??
    id.split("/").pop() ??
    id;
  return ItemDoc.parse({ title, status: legacyStatus(statusText, media.length > 0) });
}

function firstHeading(md: string): string | undefined {
  return /^#\s+(.+)$/m.exec(md)?.[1]?.trim();
}

function cleanTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  return title
    .replace(/\s+(posting guide|posting copy|posting|publication status|test status|status)$/i, "")
    .replace(/\s*[—–-]\s*$/, "")
    .trim();
}

/** Map free-form `- status: …` lines from older STATUS.md files onto the board. */
export function legacyStatus(statusMd: string, hasMedia: boolean): ItemStatus {
  const raw = /^[-*]\s*status:\s*(.+)$/im.exec(statusMd)?.[1]?.toLowerCase() ?? "";
  if (raw.includes("publish")) return "published";
  if (raw.includes("schedul") && !raw.includes("ready")) return "scheduled";
  if (raw.includes("archiv") || raw.includes("retired")) return "archived";
  if (
    raw.includes("ready-to-schedule") ||
    raw.includes("ready-to-post") ||
    raw.includes("approved")
  ) {
    return "approved";
  }
  if (raw.includes("review")) return "review";
  if (raw.includes("draft") || raw.includes("progress")) return "drafting";
  return hasMedia ? "review" : "idea";
}

export async function createItem(
  ws: Workspace,
  input: {
    title: string;
    id?: string;
    format?: string;
    reference?: string;
    hook?: string;
    notes?: string;
  },
): Promise<Item> {
  const base =
    input.id ?? (input.format ? `${input.format}/${slugify(input.title)}` : slugify(input.title));
  let id = base;
  for (let n = 2; ws.exists(itemDir(ws, id)); n++) id = `${base}-${n}`;
  const now = nowIso();
  const doc = ItemDoc.parse({ ...input, status: "idea", created: now, updated: now });
  await ws.writeYaml(`${itemDir(ws, id)}/${ITEM_FILE}`, doc);
  return getItem(ws, id);
}

/** Read-modify-write an item. Legacy items get an item.yaml on first write. */
export async function mutateItem(
  ws: Workspace,
  id: string,
  fn: (doc: ItemDoc) => ItemDoc | void,
): Promise<Item> {
  const item = await getItem(ws, id);
  const doc = structuredClone(item.doc);
  const next = ItemDoc.parse({ ...(fn(doc) ?? doc), updated: nowIso() });
  await ws.writeYaml(`${item.dir}/${ITEM_FILE}`, next);
  return getItem(ws, id);
}

export type ItemPatch = Partial<
  Pick<
    ItemDoc,
    "title" | "status" | "format" | "reference" | "hook" | "caption" | "notes" | "platforms"
  >
>;

export function updateItem(ws: Workspace, id: string, patch: ItemPatch): Promise<Item> {
  return mutateItem(ws, id, (doc) => {
    const { platforms, ...rest } = patch;
    Object.assign(doc, rest);
    if (platforms) {
      for (const [platform, copy] of Object.entries(platforms)) {
        const key = platform as keyof typeof doc.platforms;
        doc.platforms[key] = { ...doc.platforms[key], ...copy };
      }
    }
  });
}

export function addFeedback(
  ws: Workspace,
  id: string,
  input: { body: string; author?: string; media?: string; timecode?: number },
): Promise<Item> {
  return mutateItem(ws, id, (doc) => {
    const entry: Feedback = {
      id: randomUUID().slice(0, 8),
      at: nowIso(),
      author: input.author ?? "you",
      body: input.body,
      status: "open",
    };
    if (input.media) entry.media = input.media;
    if (input.timecode !== undefined) entry.timecode = input.timecode;
    doc.feedback.push(entry);
    if (doc.status === "approved") doc.status = "review";
  });
}

export function resolveFeedback(
  ws: Workspace,
  id: string,
  feedbackId: string,
  resolution: string,
): Promise<Item> {
  return mutateItem(ws, id, (doc) => {
    const entry = doc.feedback.find((f) => f.id === feedbackId);
    if (!entry) throw new Error(`Feedback ${feedbackId} not found on ${id}`);
    entry.status = "resolved";
    entry.resolution = resolution;
    entry.resolvedAt = nowIso();
  });
}

export function upsertSchedule(ws: Workspace, id: string, entry: ScheduleEntry): Promise<Item> {
  return mutateItem(ws, id, (doc) => {
    const i = doc.schedule.findIndex((s) => s.platform === entry.platform);
    if (i >= 0) doc.schedule[i] = entry;
    else doc.schedule.push(entry);
    if (entry.status === "scheduled" && doc.status !== "published") doc.status = "scheduled";
    if (entry.status === "published") doc.status = "published";
  });
}

export function recordMetrics(ws: Workspace, id: string, entry: MetricsEntry): Promise<Item> {
  return mutateItem(ws, id, (doc) => {
    doc.metrics.push(entry);
  });
}

export async function openFeedback(
  ws: Workspace,
): Promise<{ item: string; title: string; feedback: Feedback }[]> {
  const items = await listItems(ws);
  return items.flatMap((item) =>
    item.doc.feedback
      .filter((f) => f.status === "open")
      .map((feedback) => ({ item: item.id, title: item.doc.title, feedback })),
  );
}
