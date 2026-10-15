import { DateTime, Effect, Option, Path } from "effect";

import { InvalidRequest, type NotFound } from "./errors.ts";
import { checkFormatDoc, itemFormat } from "./formatSpec.ts";
import { type MediaCapture, recordMedia } from "./history.ts";
import {
  type Item,
  addFeedback,
  findFeedback,
  getItem,
  mutateItem,
  resolveFeedback,
  updateFeedback,
  withDecision,
} from "./items.ts";
import type { Format } from "./library.ts";
import { extension, ffmpeg, type MediaKind } from "./media.ts";
import { refDir } from "./references.ts";
import type { AgentName, EditContext, Feedback, FeedbackInput, ItemDoc, Region } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** Clip length when the request names a single point instead of a range. */
const POINT_CLIP_SECONDS = 3;

export const editDir = (item: Item, feedbackId: string) => `${item.dir}/edits/${feedbackId}`;

/** Item-relative path (the form feedback.context stores) for a workspace-relative path. */
const itemRel = (item: Item, rel: string) => rel.slice(item.dir.length + 1);

export interface EditRequested {
  readonly item: Item;
  readonly feedback: Feedback;
  /** Context files that could not be made; the request stands without them. */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Record an edit request and prepare what the agent needs: the selected range as a clip, the
 * frame with the region drawn on it, and a snapshot of the media as it is now (the "before" side
 * of the comparison). A request without media is about the item as a whole, such as making its
 * first video. A request `waiting` for the board's agent gets its snapshot when its turn comes,
 * so it starts from what the requests before it left.
 */
export const requestEdit = Effect.fn("edits.requestEdit")(function* (
  id: string,
  input: FeedbackInput,
  waiting?: AgentName,
) {
  const current = yield* getItem(id);
  const mediaName = input.media;
  const media = current.media.find((m) => m.name === mediaName);

  if (mediaName !== undefined && media === undefined) {
    return yield* new InvalidRequest({ message: `No media named ${mediaName} on ${id}` });
  }

  if (media === undefined && (input.timecode !== undefined || input.region !== undefined)) {
    return yield* new InvalidRequest({ message: "A range or box needs the media file it is on" });
  }

  const added = yield* addFeedback(id, input, waiting);
  const before = waiting === undefined ? yield* saveBefore(added.item, added.feedback) : undefined;

  if (media === undefined) {
    const result: EditRequested = { item: added.item, feedback: added.feedback, warnings: [] };

    return result;
  }

  const made = yield* buildContext(added.item, added.feedback, media.name, media.kind);
  const context: EditContext = { ...made.context, before };

  const item = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, added.feedback.id, (entry) => ({ ...entry, context })),
  );

  const result: EditRequested = {
    item,
    feedback: yield* findFeedback(item, added.feedback.id),
    warnings: made.warnings,
  };

  return result;
});

/**
 * Save the media as it is now: the request's file as its "before" side, and the item's files in
 * its history, so what the agent changes can be undone. Returns the item-relative copy, if any.
 */
const saveBefore = Effect.fnUntraced(function* (item: Item, f: Feedback) {
  const ws = yield* Workspace;
  const mediaName = f.media;

  if (mediaName === undefined) {
    const captures = item.media.map((m) => ({ media: m.name, start: true }));
    yield* recordMedia(item, captures, { cause: "outside" });

    return undefined;
  }

  if (!item.media.some((m) => m.name === mediaName)) {
    return yield* new InvalidRequest({ message: `${mediaName} is no longer on ${item.id}` });
  }

  const before = `${editDir(item, f.id)}/before.${extension(mediaName)}`;
  yield* ws.copy(`${item.dir}/${mediaName}`, before);
  const file = itemRel(item, before);
  yield* recordMedia(item, [{ media: mediaName, file, start: true }], { cause: "outside" });

  return file;
});

/** The range as a clip and the frame with the region drawn on it, as the user saw them. */
const buildContext = Effect.fnUntraced(function* (
  item: Item,
  f: Feedback,
  mediaName: string,
  kind: MediaKind,
) {
  const ws = yield* Workspace;
  const sourceAbs = yield* ws.abs(`${item.dir}/${mediaName}`);
  const dir = editDir(item, f.id);
  const warnings: string[] = [];
  yield* ws.mkdir(dir);

  /** One ffmpeg output for the agent; a failure becomes a warning instead of failing the request. */
  const attempt = (label: string, out: string, args: (outAbs: string) => ReadonlyArray<string>) =>
    Effect.flatMap(ws.abs(out), (outAbs) => ffmpeg(args(outAbs))).pipe(
      Effect.as(itemRel(item, out)),
      Effect.tapError((error) => Effect.sync(() => warnings.push(`${label}: ${error.message}`))),
      Effect.option,
      Effect.map(Option.getOrUndefined),
    );

  const start = f.timecode;

  const clip =
    kind === "video" && start !== undefined
      ? yield* attempt("clip", `${dir}/clip.mp4`, (out) => clipArgs(sourceAbs, out, start, f.end))
      : undefined;

  const frameAt = f.region?.at ?? f.timecode;

  const frame =
    kind === "image" || frameAt !== undefined
      ? yield* attempt("frame", `${dir}/frame.png`, (out) =>
          frameArgs(sourceAbs, out, kind === "video" ? frameAt : undefined, f.region),
        )
      : undefined;

  const context: EditContext = { clip, frame };

  return { context, warnings };
});

/** A request lined up for the board's agent. */
export type Waiting = Feedback & { readonly waiting: AgentName };

export const isWaiting = (f: Feedback): f is Waiting =>
  f.waiting !== undefined && f.status === "open";

/** The requests waiting for the board's agent on an item, in the order they were made. */
export const waitingLine = (doc: ItemDoc): ReadonlyArray<Waiting> => doc.feedback.filter(isWaiting);

/**
 * Ready a request for its run. One that waited for others on the item leaves the line, so it can
 * no longer be reworded or cancelled, and starts from what they left: the media is saved as its
 * "before" side now, and its changes count from now.
 */
export const beginEdit = Effect.fn("edits.beginEdit")(function* (id: string, feedbackId: string) {
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);

  if (f.waiting === undefined) return { item, feedback: f };

  const baseline = yield* nowIso;
  const before = yield* saveBefore(item, f);

  const next = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => ({
      ...entry,
      waiting: undefined,
      baseline,
      context: before === undefined ? entry.context : { ...entry.context, before },
    })),
  );

  return { item: next, feedback: yield* findFeedback(next, feedbackId) };
});

/** Change what a request still waiting for its turn asks for. */
export const rewordWaiting = Effect.fn("edits.rewordWaiting")(function* (
  id: string,
  feedbackId: string,
  body: string,
) {
  const text = body.trim();

  if (text === "") return yield* new InvalidRequest({ message: "A request needs a message" });

  return yield* mutateItem(id, (doc): Effect.Effect<ItemDoc, InvalidRequest | NotFound> =>
    doc.feedback.some((f) => f.id === feedbackId && isWaiting(f))
      ? updateFeedback(doc, id, feedbackId, (entry) => ({ ...entry, body: text }))
      : Effect.fail(new InvalidRequest({ message: "Only a waiting request can be changed" })),
  );
});

/**
 * Take requests out of the item's waiting line: the one named, or all of them. They never ran, so
 * they go, with the files made for them.
 */
export const cancelWaiting = Effect.fn("edits.cancelWaiting")(function* (
  id: string,
  feedbackId?: string,
) {
  const ws = yield* Workspace;

  const cancelled = (f: Feedback) =>
    isWaiting(f) && (feedbackId === undefined || f.id === feedbackId);

  const { doc } = yield* getItem(id);

  if (feedbackId !== undefined && !doc.feedback.some(cancelled)) {
    return yield* new InvalidRequest({ message: "Only a waiting request can be cancelled" });
  }

  // One may have started since it was read; it stays.
  const next = yield* mutateItem(id, (current) =>
    Effect.succeed({ ...current, feedback: current.feedback.filter((f) => !cancelled(f)) }),
  );

  const kept = new Set(next.doc.feedback.map((f) => f.id));
  const gone = doc.feedback.filter((f) => cancelled(f) && !kept.has(f.id));
  yield* Effect.forEach(gone, (f) => ws.remove(editDir(next, f.id)), { discard: true });

  return next;
});

/** Frame-accurate re-encode of [start, end); a single point becomes a short clip from it. */
export function clipArgs(src: string, out: string, start: number, end?: number): string[] {
  const duration = end === undefined ? POINT_CLIP_SECONDS : end - start;

  return [
    "-ss",
    String(start),
    "-i",
    src,
    "-t",
    duration.toFixed(3),
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-movflags",
    "+faststart",
    out,
  ];
}

export function frameArgs(src: string, out: string, at?: number, region?: Region): string[] {
  const seek = at === undefined ? [] : ["-ss", String(at)];
  const box = region === undefined ? [] : ["-vf", drawboxFilter(region)];

  return [...seek, "-i", src, "-frames:v", "1", ...box, out];
}

const fixed4 = (v: number) => v.toFixed(4);

const percent = (v: number) => `${Math.round(v * 100)}%`;

/** ffmpeg drawbox in frame-relative units, so the stored region works at any resolution. */
export function drawboxFilter(r: Region): string {
  const [x, y, w, h] = [r.x, r.y, r.w, r.h].map(fixed4);

  return `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=red@0.9:t=8`;
}

const millis = (iso: string) =>
  Option.match(DateTime.make(iso), { onNone: () => 0, onSome: DateTime.toEpochMillis });

/** When the request's changes start counting, in epoch milliseconds: when work on it began. */
export const baselineMillis = (f: Feedback) => millis(f.baseline ?? f.at);

/**
 * Save the media as it is now as the "after" side, if it changed since the request.
 * Agents edit the media file in place, so a later request would otherwise lose this result.
 * Files the request changed are also saved into the item's history, so they can be undone.
 */
export const snapshotAfter = Effect.fn("edits.snapshotAfter")(function* (
  id: string,
  feedbackId: string,
) {
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);

  if (f.decision !== undefined) return item;
  const after = yield* saveAfter(item, f);

  const captures = item.media.map(({ name }): MediaCapture => {
    if (name !== f.media) return { media: name, start: f.media === undefined };

    return after === undefined
      ? { media: name }
      : { media: name, file: after, base: f.context?.before };
  });

  yield* recordMedia(item, captures, { cause: "edit", feedbackId });

  if (after === undefined) return item;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => ({
      ...entry,
      context: { ...entry.context, after },
    })),
  );
});

/** Copy the request's media to its "after" file once it changed. Returns the item-relative copy. */
const saveAfter = Effect.fnUntraced(function* (item: Item, f: Feedback) {
  const ws = yield* Workspace;
  const mediaName = f.media;

  if (mediaName === undefined || f.context?.before === undefined || f.context.after !== undefined) {
    return undefined;
  }

  const source = `${item.dir}/${mediaName}`;

  if (!(yield* ws.exists(source))) return undefined;
  const { mtime } = yield* ws.stat(source);

  if (mtime <= baselineMillis(f)) return undefined;
  const after = `${editDir(item, f.id)}/after.${extension(mediaName)}`;
  yield* ws.copy(source, after);

  return itemRel(item, after);
});

/** Resolve a request and keep the result for comparison. Used by agents (MCP) and the runner. */
export const resolveEdit = Effect.fn("edits.resolveEdit")(function* (
  id: string,
  feedbackId: string,
  resolution: string,
) {
  yield* snapshotAfter(id, feedbackId);

  return yield* resolveFeedback(id, feedbackId, resolution);
});

/** The user keeps the result. */
export const approveEdit = Effect.fn("edits.approveEdit")(function* (
  id: string,
  feedbackId: string,
) {
  yield* snapshotAfter(id, feedbackId);
  const now = yield* nowIso;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => withDecision(entry, "approved", now)),
  );
});

/** The user rolls the media back to how it was when the request was made. */
export const restoreBefore = Effect.fn("edits.restoreBefore")(function* (
  id: string,
  feedbackId: string,
) {
  const ws = yield* Workspace;
  yield* snapshotAfter(id, feedbackId);
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);
  const before = f.context?.before;

  if (f.media === undefined || before === undefined) {
    return yield* new InvalidRequest({ message: "This request has no saved before version" });
  }

  yield* ws.copy(`${item.dir}/${before}`, `${item.dir}/${f.media}`);
  yield* recordMedia(item, [{ media: f.media, file: before }], { cause: "restore", feedbackId });
  const now = yield* nowIso;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => withDecision(entry, "restored", now)),
  );
});

/** `75.25` → `1:15.3`. */
export function formatTimecode(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const minutes = Math.floor(tenths / 600);
  const rest = ((tenths % 600) / 10).toFixed(1).padStart(4, "0");

  return `${minutes}:${rest}`;
}

/** Human description of what a request points at, shared by the prompt and the UI copy. */
export function describeTarget(f: Feedback): string {
  const parts: string[] = [];

  if (f.timecode !== undefined) {
    parts.push(
      f.end === undefined
        ? `at ${formatTimecode(f.timecode)} (${f.timecode}s)`
        : `${formatTimecode(f.timecode)}–${formatTimecode(f.end)} (${f.timecode}s to ${f.end}s)`,
    );
  }

  if (f.region !== undefined) {
    const { x, y, w, h, at } = f.region;
    parts.push(
      `region x ${percent(x)}, y ${percent(y)}, ${percent(w)} wide, ${percent(h)} tall of the frame at ${at}s`,
    );
  }

  return parts.length === 0 ? "the whole file" : parts.join("; ");
}

/** The item's inputs as the format names them, with the files to read for each choice. */
const inputLines = Effect.fnUntraced(function* (item: Item, format: Format | undefined) {
  const ws = yield* Workspace;
  const fields = format?.doc.inputs ?? [];
  const lines: string[] = [];

  for (const [id, value] of Object.entries(item.doc.inputs ?? {})) {
    const field = fields.find((candidate) => candidate.id === id);
    const choice = field?.choices.find((candidate) => candidate.id === value);

    if (field === undefined || format === undefined) {
      lines.push(`- ${id}: ${value}`);
      continue;
    }

    if (choice === undefined) {
      lines.push(`- ${field.title}: ${value}`);
      continue;
    }

    const files = yield* Effect.forEach(choice.files, (file) => ws.abs(`${format.dir}/${file}`));
    const read = files.length === 0 ? "" : `; read ${files.join(", ")}`;

    lines.push(`- ${field.title}: ${choice.title} (${choice.id})${read}`);
  }

  return lines;
});

/** The format's own files and skills, and what it still lacks on this machine. */
const formatLines = Effect.fnUntraced(function* (format: Format) {
  const ws = yield* Workspace;
  const check = yield* checkFormatDoc(format);
  const files = [`${format.dir}/format.yaml`];

  if (format.readme !== undefined) files.push(`${format.dir}/README.md`);

  const read = yield* Effect.forEach(files, (file) => ws.abs(file));
  const lines = [`- Format: ${format.id}. Read ${read.join(" and ")} first.`];

  const skills = yield* Effect.forEach(Object.entries(check.skills), ([name, file]) =>
    Effect.map(ws.abs(file), (path) => `${name} (${path})`),
  );

  if (skills.length > 0) lines.push(`- Skills to follow: ${skills.join(", ")}`);

  const missing = check.problems.map((problem) => problem.message);

  return { lines, missing };
});

/** What the user pointed the item at: folders and files on this computer, pages, a reference. */
const sourceLines = Effect.fnUntraced(function* (item: Item) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;

  const lines = item.doc.sources.map((source) =>
    "url" in source
      ? `- ${source.url} (a web page)`
      : `- ${path.resolve(ws.root, source.path)} (on this computer)`,
  );

  if (item.doc.reference !== undefined) {
    const dir = path.resolve(ws.root, refDir(ws, item.doc.reference));
    lines.push(`- ${dir} (a saved reference video; get_reference has its analysis)`);
  }

  return lines;
});

/** The message an agent receives for one request, headless or pasted by the user. */
export const buildEditPrompt = Effect.fn("edits.buildEditPrompt")(function* (
  item: Item,
  f: Feedback,
) {
  const ws = yield* Workspace;
  const abs = (rel: string) => ws.abs(`${item.dir}/${rel}`);
  const folder = yield* ws.abs(item.dir);

  const lines = [
    `Edit request ${f.id} on content item "${item.id}" (${item.doc.title}) in the Content Factory workspace at ${ws.root}. Follow the content-factory skill.`,
    "",
    `Request: ${f.body}`,
    "",
  ];

  const format = Option.getOrUndefined(yield* itemFormat(item.doc.format));
  const described = format === undefined ? undefined : yield* formatLines(format);
  const named = item.doc.format === undefined ? [] : [`- Format: ${item.doc.format}`];

  const brief = [
    ...(described?.lines ?? named),
    ...(yield* inputLines(item, format)),
    ...(item.doc.hook === undefined ? [] : [`- Hook: ${item.doc.hook}`]),
    ...(item.doc.notes === undefined ? [] : [`- Notes: ${item.doc.notes}`]),
  ];

  if (brief.length > 0) lines.push("Item brief:", ...brief, "");

  const sources = yield* sourceLines(item);

  if (sources.length > 0) {
    lines.push(
      "Sources the user pointed this item at. Read what helps with the request, and never change them:",
      ...sources,
      "",
    );
  }

  if (described !== undefined && described.missing.length > 0) {
    lines.push(
      "The format still lacks:",
      ...described.missing.map((message) => `- ${message}`),
      "If the request needs any of it, say so and stop rather than working around it.",
      "",
    );
  }

  lines.push("Target:");

  if (f.media !== undefined) {
    lines.push(`- Media: ${yield* abs(f.media)}`, `- Where: ${describeTarget(f)}`);
    const { clip, frame, before } = f.context ?? {};

    if (clip !== undefined) lines.push(`- Clip of the range: ${yield* abs(clip)}`);

    if (frame !== undefined) {
      const marked = f.region === undefined ? "" : " (the red box marks the area)";
      lines.push(`- Frame${marked}: ${yield* abs(frame)} — open it`);
    }

    if (before !== undefined)
      lines.push(`- Saved copy of the media as it is now: ${yield* abs(before)}`);

    if (f.baseline !== undefined && (clip !== undefined || frame !== undefined)) {
      const { mtime } = yield* ws.stat(`${item.dir}/${f.media}`);

      if (mtime > millis(f.at)) {
        lines.push(
          "- Earlier requests on this item changed the media after the user marked this spot. The clip and frame show it as the user saw it; find the same spot in the media as it is now.",
        );
      }
    }

    lines.push(
      "",
      "Change only what the request asks for. Write the result over the same media file name; the previous version is already saved, and the user compares before and after on the board.",
    );
  } else if (item.media.length > 0) {
    const files = yield* Effect.forEach(item.media, (m) => abs(m.name));
    lines.push("- The item as a whole. Its media:", ...files.map((file) => `  - ${file}`));
    lines.push(
      "",
      "Work on the media the request is about and keep its file name, so the board keeps showing it.",
    );
  } else {
    const aspect = format?.doc.aspects[0] ?? "9x16";

    const video =
      format?.doc.requireAudio === false ? "H.264 mp4" : "H.264/AAC mp4 with an audio track";

    lines.push(
      `- The item has no video yet. Make it in ${folder}, named like \`[${aspect}] ${item.id.split("/").at(-1) ?? "video"}.mp4\` (the bracket is the aspect ratio).`,
      "",
      `Render an ${video} that fits the request and the item brief.`,
    );
  }

  lines.push(
    "Use ffmpeg/ffprobe or the format's render command. Afterwards run verify_item, look at a frame from the changed part, then call resolve_feedback with this feedback id and one line on what changed.",
    "Finish with a short, plain summary for someone who does not use video editors. If the request is unclear, ask instead of guessing and leave the feedback open.",
  );

  return lines.join("\n");
});
