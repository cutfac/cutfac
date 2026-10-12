import { DateTime, Effect, Option } from "effect";

import { InvalidRequest } from "./errors.ts";
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
import { extension, type MediaKind } from "./media.ts";
import { runChecked } from "./process.ts";
import type { EditContext, Feedback, FeedbackInput, Region } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** Clip length when the request names a single point instead of a range. */
const POINT_CLIP_SECONDS = 3;

export const editDir = (item: Item, feedbackId: string) => `${item.dir}/edits/${feedbackId}`;

/** Item-relative path (the form feedback.context stores) for a workspace-relative path. */
const itemRel = (item: Item, rel: string) => rel.slice(item.dir.length + 1);

const ffmpeg = (args: ReadonlyArray<string>) =>
  Effect.asVoid(runChecked("ffmpeg", ["-y", "-v", "error", ...args]));

export interface EditRequested {
  readonly item: Item;
  readonly feedback: Feedback;
  /** Context files that could not be made; the request stands without them. */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Record an edit request and prepare what the agent needs: a snapshot of the media as it is now
 * (the "before" side of the comparison), the selected range as a clip, and the frame with the
 * region drawn on it. A request without media is about the item as a whole, such as making its
 * first video.
 */
export const requestEdit = Effect.fn("edits.requestEdit")(function* (
  id: string,
  input: FeedbackInput,
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

  const added = yield* addFeedback(id, input);

  if (media === undefined) {
    // Save the item's files as they are now, so the agent's changes to them can be undone.
    const captures = added.item.media.map((m) => ({ media: m.name, start: true }));
    yield* recordMedia(added.item, captures, { cause: "outside" });
    const result: EditRequested = { item: added.item, feedback: added.feedback, warnings: [] };

    return result;
  }

  const { context, warnings } = yield* buildContext(
    added.item,
    added.feedback,
    media.name,
    media.kind,
  );

  const snapshot = [{ media: media.name, file: context.before, start: true }];
  yield* recordMedia(added.item, snapshot, { cause: "outside" });

  const item = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, added.feedback.id, (entry) => ({ ...entry, context })),
  );

  const result: EditRequested = {
    item,
    feedback: yield* findFeedback(item, added.feedback.id),
    warnings,
  };

  return result;
});

const buildContext = Effect.fnUntraced(function* (
  item: Item,
  f: Feedback,
  mediaName: string,
  kind: MediaKind,
) {
  const ws = yield* Workspace;
  const source = `${item.dir}/${mediaName}`;
  const sourceAbs = yield* ws.abs(source);
  const dir = editDir(item, f.id);
  const warnings: string[] = [];

  const before = `${dir}/before.${extension(mediaName)}`;
  yield* ws.copy(source, before);

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

  const context: EditContext = { before: itemRel(item, before), clip, frame };

  return { context, warnings };
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

/** When the request was made, in epoch milliseconds. */
export const requestedAtMillis = (f: Feedback) =>
  Option.match(DateTime.make(f.at), { onNone: () => 0, onSome: DateTime.toEpochMillis });

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

  if (mtime <= requestedAtMillis(f)) return undefined;
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

  const brief = [
    item.doc.format === undefined ? undefined : `- Format: ${item.doc.format}`,
    item.doc.hook === undefined ? undefined : `- Hook: ${item.doc.hook}`,
    item.doc.notes === undefined ? undefined : `- Notes: ${item.doc.notes}`,
  ].flatMap((line) => (line === undefined ? [] : [line]));

  if (brief.length > 0) lines.push("Item brief:", ...brief, "");

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
    lines.push(
      `- The item has no video yet. Make it in ${folder}, named like \`[9x16] ${item.id.split("/").at(-1) ?? "video"}.mp4\` (the bracket is the aspect ratio).`,
      "",
      "Render an H.264/AAC mp4 with an audio track that fits the request and the item brief.",
    );
  }

  lines.push(
    "Use ffmpeg/ffprobe or the format's render command. Afterwards run verify_item, look at a frame from the changed part, then call resolve_feedback with this feedback id and one line on what changed.",
    "Finish with a short, plain summary for someone who does not use video editors. If the request is unclear, ask instead of guessing and leave the feedback open.",
  );

  return lines.join("\n");
});
