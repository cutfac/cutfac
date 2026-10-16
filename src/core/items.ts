import { Crypto, Effect, Option, Path, Schema } from "effect";

import { InvalidRequest, NotFound, type WorkspaceError } from "./errors.ts";
import { inputFieldsOf, resolveInputs } from "./formatSpec.ts";
import { aspectOf, extension, type MediaFile, mediaKind, probe, toMediaFiles } from "./media.ts";
import {
  type AgentPick,
  type Feedback,
  type FeedbackInput,
  ItemDoc,
  type ItemPatch,
  type ItemStatus,
  StoredItemStatus,
} from "./schema.ts";
import { cleanSources } from "./sources.ts";
import { Workspace, type WorkspaceService, nowIso, slugify } from "./workspace.ts";

export const ITEM_FILE = "item.yaml";

const SKIP_DIRS = new Set(["node_modules", "review", "frames", "raw", "edits", "history"]);

const MAX_DEPTH = 4;

export interface Item {
  readonly id: string;
  /** Workspace-relative folder. */
  readonly dir: string;
  readonly doc: ItemDoc;
  readonly media: ReadonlyArray<MediaFile>;
  /** Markdown files in the item folder, by name. */
  readonly docs: ReadonlyArray<string>;
  /** Latest mtime of anything directly in the folder, in epoch milliseconds. */
  readonly updatedAt: number;
}

const itemDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.items}/${id}`;

/** item.yaml as earlier versions also wrote it, with their statuses and a separate caption. */
const StoredItemDoc = Schema.Struct({
  ...ItemDoc.fields,
  status: StoredItemStatus.pipe(Schema.withDecodingDefault(Effect.succeed("drafting"))),
  caption: Schema.optional(Schema.String),
});

/** Moves what earlier versions kept in fields of their own to where it lives now. */
export function upgradeItemDoc({ caption, ...doc }: typeof StoredItemDoc.Type): ItemDoc {
  const kept = caption?.trim() ?? "";

  if (kept === "") return doc;

  const moved = `Caption: ${kept}`;

  return { ...doc, notes: doc.notes === undefined ? moved : `${doc.notes}\n\n${moved}` };
}

/** An item id is a `/`-separated path under the items folder, such as `hooks/first-try`. */
export const isItemId = (id: string) =>
  !id.includes("\\") &&
  id.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");

const checkItemId = (id: string) =>
  isItemId(id)
    ? Effect.void
    : Effect.fail(new InvalidRequest({ message: `Not an item id: ${id}` }));

/** A short random id for feedback entries. */
export const shortId = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const uuid = yield* Effect.orDie(crypto.randomUUIDv4());

  return uuid.replaceAll("-", "").slice(0, 8);
});

/** Walk the items root; an item is any folder with item.yaml, and other folders group items. */
export const listItemIds = Effect.fn("items.listItemIds")(function* () {
  const ws = yield* Workspace;
  const root = ws.config.paths.items;
  const ids: string[] = [];

  const walk = (rel: string, depth: number): Effect.Effect<void, WorkspaceError> =>
    Effect.gen(function* () {
      const entries = yield* ws.list(rel);

      if (rel !== root && entries.some((entry) => entry.name === ITEM_FILE)) {
        ids.push(rel.slice(root.length + 1));

        return;
      }

      if (depth > MAX_DEPTH) return;

      for (const entry of entries) {
        if (entry.dir && !SKIP_DIRS.has(entry.name)) yield* walk(`${rel}/${entry.name}`, depth + 1);
      }
    });

  yield* walk(root, 0);

  return ids.toSorted((a, b) => a.localeCompare(b));
});

export const getItem = Effect.fn("items.getItem")(function* (id: string) {
  const ws = yield* Workspace;
  yield* checkItemId(id);
  const dir = itemDir(ws, id);

  if (!(yield* ws.exists(`${dir}/${ITEM_FILE}`))) {
    return yield* new NotFound({ message: `Item not found: ${id}` });
  }

  const entries = yield* ws.list(dir);
  const media = toMediaFiles(entries);

  const docs = entries.flatMap((entry) =>
    !entry.dir && entry.name.endsWith(".md") ? [entry.name] : [],
  );

  const updatedAt = Math.max(0, ...entries.map((entry) => entry.mtime));
  const doc = upgradeItemDoc(yield* ws.readYaml(`${dir}/${ITEM_FILE}`, StoredItemDoc));
  const item: Item = { id, dir, doc, media, docs, updatedAt };

  return item;
});

export const listItems = Effect.fn("items.listItems")(function* () {
  const ids = yield* listItemIds();

  return yield* Effect.forEach(ids, getItem, { concurrency: 8 });
});

/** An item.yaml with nothing but a title and status. */
export function emptyItemDoc(title: string, status: ItemStatus): ItemDoc {
  return {
    title,
    status,
    sources: [],
    feedback: [],
    sessions: {},
  };
}

export interface NewItemInput {
  readonly title: string;
  readonly id?: string | undefined;
  readonly format?: string | undefined;
  readonly hook?: string | undefined;
  readonly notes?: string | undefined;
  /** Values for the format's inputs, by input id; defaults fill in the rest. */
  readonly inputs?: Readonly<Record<string, string>> | undefined;
}

/** A new item's inputs, checked against its format; an item without a format takes none. */
const itemInputs = Effect.fnUntraced(function* (input: NewItemInput) {
  const given = input.inputs ?? {};

  if (input.format === undefined) {
    if (Object.keys(given).length === 0) return {};

    return yield* new InvalidRequest({ message: "Inputs belong to a format; pick one first" });
  }

  return yield* resolveInputs(input.format, yield* inputFieldsOf(input.format), given);
});

/** A folder that has no item.yaml and holds no items, which an explicit id can bring in as is. */
const isAdoptable = Effect.fnUntraced(function* (ws: WorkspaceService, id: string) {
  const dir = itemDir(ws, id);

  if (!(yield* ws.exists(dir)) || (yield* ws.exists(`${dir}/${ITEM_FILE}`))) return false;

  const ids = yield* listItemIds();

  return !ids.some((other) => other.startsWith(`${id}/`));
});

/**
 * Make a folder and item.yaml for a new piece of content. Ids get a `-2`, `-3`… suffix if taken,
 * except that an explicit id naming a folder without item.yaml makes that folder the item.
 */
export const createItem = Effect.fn("items.createItem")(function* (input: NewItemInput) {
  const ws = yield* Workspace;
  const title = input.title.trim();

  if (title === "") return yield* new InvalidRequest({ message: "An item needs a title" });

  const base =
    input.id ?? (input.format === undefined ? slugify(title) : `${input.format}/${slugify(title)}`);

  yield* checkItemId(base);
  let id = base;

  if (input.id === undefined || !(yield* isAdoptable(ws, id))) {
    for (let n = 2; yield* ws.exists(itemDir(ws, id)); n++) id = `${base}-${n}`;
  }

  const inputs = yield* itemInputs(input);
  const now = yield* nowIso;

  const doc: ItemDoc = {
    ...emptyItemDoc(title, "drafting"),
    format: input.format,
    hook: input.hook,
    notes: input.notes,
    inputs: Object.keys(inputs).length === 0 ? undefined : inputs,
    created: now,
    updated: now,
  };

  yield* ws.writeYaml(`${itemDir(ws, id)}/${ITEM_FILE}`, ItemDoc, doc);

  return yield* getItem(id);
});

/**
 * Read-modify-write an item, one at a time per item, so an agent run and the board writing the
 * same item.yaml do not drop each other's changes. `change` returns the next doc, or fails to
 * leave the file as it is; it must not write the item itself.
 */
export const mutateItem = Effect.fn("items.mutateItem")(function* <E, R>(
  id: string,
  change: (doc: ItemDoc, item: Item) => Effect.Effect<ItemDoc, E, R>,
) {
  const ws = yield* Workspace;

  return yield* ws.exclusive(
    `item:${id}`,
    Effect.gen(function* () {
      const item = yield* getItem(id);
      const next = yield* change(item.doc, item);
      const updated = yield* nowIso;
      yield* ws.writeYaml(`${item.dir}/${ITEM_FILE}`, ItemDoc, { ...next, updated });

      return yield* getItem(id);
    }),
  );
});

/** Replace one feedback entry, failing if the item has none with that id. */
export const updateFeedback = (
  doc: ItemDoc,
  itemId: string,
  feedbackId: string,
  change: (entry: Feedback) => Feedback,
): Effect.Effect<ItemDoc, NotFound> =>
  doc.feedback.some((entry) => entry.id === feedbackId)
    ? Effect.succeed({
        ...doc,
        feedback: doc.feedback.map((entry) => (entry.id === feedbackId ? change(entry) : entry)),
      })
    : Effect.fail(new NotFound({ message: `Feedback ${feedbackId} not found on ${itemId}` }));

export type Decision = NonNullable<Feedback["decision"]>;

const VERDICTS: Record<Decision, string> = {
  approved: "Approved",
  restored: "Rolled back to before",
};

/** Record the user's verdict on an edit result, closing the request if it was still open. */
export const withDecision = (entry: Feedback, decision: Decision, at: string): Feedback => ({
  ...(entry.status === "open"
    ? { ...entry, status: "resolved", resolution: VERDICTS[decision], resolvedAt: at }
    : entry),
  decision,
});

export function findFeedback(item: Item, feedbackId: string): Effect.Effect<Feedback, NotFound> {
  const entry = item.doc.feedback.find((candidate) => candidate.id === feedbackId);

  return entry === undefined
    ? Effect.fail(new NotFound({ message: `Feedback ${feedbackId} not found on ${item.id}` }))
    : Effect.succeed(entry);
}

export const updateItem = Effect.fn("items.updateItem")(function* (id: string, patch: ItemPatch) {
  const { sources, ...fields } = patch;
  const cleaned = sources === undefined ? undefined : yield* cleanSources(sources);

  return yield* mutateItem(id, (doc) =>
    Effect.succeed({ ...doc, ...fields, sources: cleaned ?? doc.sources }),
  );
});

/**
 * Append a comment or edit request; `waiting` lines it up for the board's agent. An approved item
 * goes back to review.
 */
export const addFeedback = Effect.fn("items.addFeedback")(function* (
  id: string,
  input: FeedbackInput,
  waiting?: AgentPick,
) {
  const body = input.body.trim();

  if (body === "") return yield* new InvalidRequest({ message: "Feedback needs a message" });

  const entry: Feedback = {
    id: yield* shortId,
    at: yield* nowIso,
    author: input.author ?? "you",
    body,
    media: input.media,
    timecode: input.timecode,
    end: input.end,
    region: input.region,
    waiting: waiting?.agent,
    model: waiting?.model,
    effort: waiting?.effort,
    status: "open",
  };

  const item = yield* mutateItem(id, (doc) =>
    Effect.succeed({
      ...doc,
      feedback: [...doc.feedback, entry],
      status: doc.status === "done" ? "review" : doc.status,
    }),
  );

  return { item, feedback: entry };
});

export const resolveFeedback = (id: string, feedbackId: string, resolution: string) =>
  Effect.flatMap(nowIso, (resolvedAt) =>
    mutateItem(id, (doc) =>
      updateFeedback(doc, id, feedbackId, (entry) => ({
        ...entry,
        status: "resolved",
        resolution,
        resolvedAt,
      })),
    ),
  );

export interface OpenFeedback {
  readonly item: string;
  readonly title: string;
  readonly feedback: Feedback;
}

export const openFeedback = Effect.fn("items.openFeedback")(function* () {
  const items = yield* listItems();

  return items.flatMap((item) =>
    item.doc.feedback.flatMap((feedback): OpenFeedback[] =>
      feedback.status === "open" ? [{ item: item.id, title: item.doc.title, feedback }] : [],
    ),
  );
});

/** `[9x16] demo.mp4` → `demo.mp4`: the aspect tag is set from the file, not trusted from a name. */
const stripAspectTag = (name: string) => name.replace(/^\[\d+x\d+\]\s*/, "");

/**
 * Copy an uploaded or picked file into an item as media, named `[aspect] name.ext` when ffprobe
 * can read its frame size. A name that is already taken gets a `-2`, `-3`… suffix.
 */
export const importMedia = Effect.fn("items.importMedia")(function* (
  id: string,
  source: string,
  fileName: string,
) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const item = yield* getItem(id);
  const clean = stripAspectTag(path.basename(fileName.replaceAll("\\", "/")).trim());

  if (mediaKind(clean) === undefined) {
    return yield* new InvalidRequest({ message: `Not a video or image file: ${fileName}` });
  }

  const probed = yield* Effect.option(probe(source));
  const aspect = Option.flatMapNullishOr(probed, (p) => aspectOf(p.width, p.height));
  const ext = extension(clean);
  const stem = clean.slice(0, clean.length - ext.length - 1);
  const tag = Option.match(aspect, { onNone: () => "", onSome: (value) => `[${value}] ` });
  let name = `${tag}${stem}.${ext}`;

  for (let n = 2; item.media.some((m) => m.name === name); n++) name = `${tag}${stem}-${n}.${ext}`;

  yield* ws.importFile(source, `${item.dir}/${name}`);

  return { item: yield* getItem(id), name };
});
