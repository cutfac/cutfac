import { Effect, Option, Path } from "effect";

import { ABOUT_FILE } from "./about.ts";
import { BRIEF_FILE, briefLines, readBrief } from "./brief.ts";
import { checkFormatDoc, itemFormat } from "./formatSpec.ts";
import type { Item } from "./items.ts";
import type { Format } from "./library.ts";
import { mediaKind } from "./media.ts";
import { REFERENCES } from "./references.ts";
import type { Feedback } from "./schema.ts";
import { isoMillis } from "./time.ts";
import { Workspace } from "./workspace.ts";

const percent = (v: number) => `${Math.round(v * 100)}%`;

const itemAbs = (item: Item, rel: string) =>
  Effect.flatMap(Workspace, (ws) => ws.abs(`${item.dir}/${rel}`));

const versionsWanted = (f: Feedback) => f.variants?.wanted ?? 1;

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

interface FormatNotes {
  readonly lines: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

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

/** What the user pointed the item at: folders and files on this computer, and pages. */
const sourceLines = Effect.fnUntraced(function* (item: Item) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;

  if (item.doc.sources.length === 0) return [];

  return [
    "Sources the user pointed this item at. Read what helps with the request, and never change them:",
    ...item.doc.sources.map((source) =>
      "url" in source
        ? `- ${source.url} (a web page)`
        : `- ${path.resolve(ws.root, source.path)} (on this computer)`,
    ),
    "",
  ];
});

/**
 * The pictures an agent should see with a request, as absolute paths: the marked frame, then the
 * attached images. A picture removed from the references while the request waited is left out.
 */
export const editImages = Effect.fn("edits.editImages")(function* (item: Item, f: Feedback) {
  const ws = yield* Workspace;

  const pictures = [
    ...(f.context?.frame === undefined ? [] : [f.context.frame]),
    ...(f.attachments ?? []).filter((path) => Option.contains(mediaKind(path), "image")),
  ];

  const kept = yield* Effect.filter(pictures, (path) => ws.exists(`${item.dir}/${path}`));

  return yield* Effect.forEach(kept, (path) => itemAbs(item, path));
});

const answerLines = (item: Item, f: Feedback) => {
  const question = item.doc.feedback.find((entry) => entry.id === f.answers)?.run?.reply?.trim();

  if (question === undefined || question === "") return [];

  return [
    `It answers what you asked on request ${f.answers}. Your reply there:`,
    ...question.split("\n").map((line) => `> ${line}`),
    "",
  ];
};

const attachmentLines = Effect.fnUntraced(function* (item: Item, f: Feedback) {
  if (f.attachments === undefined || f.attachments.length === 0) return [];

  const attached = yield* Effect.forEach(f.attachments, (path) => itemAbs(item, path));

  return [
    "Files the user attached to this request. Open them; never change them:",
    ...attached.map((path) => `- ${path}`),
    "",
  ];
});

const referenceLines = Effect.fnUntraced(function* (item: Item) {
  const ws = yield* Workspace;

  if (!(yield* ws.exists(`${item.dir}/${REFERENCES}`))) return [];

  return [
    `Reference files the user keeps for this item: ${yield* itemAbs(item, REFERENCES)}. Look there when the request needs material.`,
    "",
  ];
});

const itemBriefLines = Effect.fnUntraced(function* (
  item: Item,
  format: Format | undefined,
  notes: FormatNotes | undefined,
) {
  const named = item.doc.format === undefined ? [] : [`- Format: ${item.doc.format}`];

  const brief = [
    ...(notes?.lines ?? named),
    ...(yield* inputLines(item, format)),
    ...(item.doc.hook === undefined ? [] : [`- Hook: ${item.doc.hook}`]),
    ...(item.doc.notes === undefined ? [] : [`- Notes: ${item.doc.notes}`]),
  ];

  return brief.length === 0 ? [] : ["Item brief:", ...brief, ""];
});

const workspaceBriefLines = Effect.fnUntraced(function* () {
  const ws = yield* Workspace;
  const brief = yield* readBrief();

  if (brief === undefined) return [];

  return [
    `What the videos are for and where they go, in the user's words: ${yield* ws.abs(BRIEF_FILE)}.`,
    ...briefLines(brief),
    "",
  ];
});

const aboutLines = Effect.fnUntraced(function* () {
  const ws = yield* Workspace;

  if (!(yield* ws.exists(ABOUT_FILE))) return [];

  return [
    `What this workspace makes videos about: ${yield* ws.abs(ABOUT_FILE)}. Read it when the request touches the product, the audience, or the voice.`,
    "",
  ];
});

const missingLines = (notes: FormatNotes | undefined) => {
  if (notes === undefined || notes.missing.length === 0) return [];

  return [
    "The format still lacks:",
    ...notes.missing.map((message) => `- ${message}`),
    "If the request needs any of it, say so and stop rather than working around it.",
    "",
  ];
};

const mediaTargetLines = Effect.fnUntraced(function* (item: Item, f: Feedback, media: string) {
  const ws = yield* Workspace;
  const lines = [`- Media: ${yield* itemAbs(item, media)}`, `- Where: ${describeTarget(f)}`];
  const { clip, frame, before } = f.context ?? {};

  if (clip !== undefined) lines.push(`- Clip of the range: ${yield* itemAbs(item, clip)}`);

  if (frame !== undefined) {
    const marked = f.region === undefined ? "" : " (the red box marks the area)";
    lines.push(`- Frame${marked}: ${yield* itemAbs(item, frame)} — open it`);
  }

  if (before !== undefined) {
    lines.push(`- Saved copy of the media as it is now: ${yield* itemAbs(item, before)}`);
  }

  if (f.baseline !== undefined && (clip !== undefined || frame !== undefined)) {
    const { mtime } = yield* ws.stat(`${item.dir}/${media}`);

    if (mtime > isoMillis(f.at)) {
      lines.push(
        "- Earlier requests on this item changed the media after the user marked this spot. The clip and frame show it as the user saw it; find the same spot in the media as it is now.",
      );
    }
  }

  lines.push(
    "",
    versionsWanted(f) > 1
      ? "Change only what the request asks for. The media as it was is already saved."
      : "Change only what the request asks for. Write the result over the same media file name; the previous version is already saved, and the user compares before and after on the board.",
  );

  return lines;
});

const wholeItemLines = Effect.fnUntraced(function* (item: Item) {
  const files = yield* Effect.forEach(item.media, (m) => itemAbs(item, m.name));

  return [
    "- The item as a whole. Its media:",
    ...files.map((file) => `  - ${file}`),
    "",
    "Work on the media the request is about and keep its file name, so the board keeps showing it.",
  ];
});

const newVideoLines = Effect.fnUntraced(function* (item: Item, format: Format | undefined) {
  const ws = yield* Workspace;
  const folder = yield* ws.abs(item.dir);
  const aspect = format?.doc.aspects[0] ?? "9x16";

  const video =
    format?.doc.requireAudio === false ? "H.264 mp4" : "H.264/AAC mp4 with an audio track";

  return [
    `- The item has no video yet. Make it in ${folder}, named like \`[${aspect}] ${item.id.split("/").at(-1) ?? "video"}.mp4\` (the bracket is the aspect ratio).`,
    "",
    `Render an ${video} that fits the request and the item brief.`,
  ];
});

const targetLines = Effect.fnUntraced(function* (
  item: Item,
  f: Feedback,
  format: Format | undefined,
) {
  if (f.media !== undefined) return yield* mediaTargetLines(item, f, f.media);

  if (item.media.length > 0) return yield* wholeItemLines(item);

  return yield* newVideoLines(item, format);
});

const versionLines = (wanted: number) =>
  wanted > 1
    ? [
        "",
        `The user asked for ${wanted} versions to compare side by side and pick from. Make ${wanted} clearly different takes on the request, not small tweaks of one.`,
        "For each: render it in full over the same file name with the render tool and the version as its label, built from the request rather than from the previous version; check it as below; then call save_variant with this feedback id and a few words on how it differs. Saving under a label already used replaces that version.",
        "Call resolve_feedback once, after the last version. The board then puts the media back as it was until the user picks one.",
        "",
      ]
    : [];

const CLOSING_LINES = [
  "Use ffmpeg/ffprobe or the format's render command, and run the final render through the render tool (not your shell) so the user sees its progress; call it again with just the id while it is running. Afterwards run verify_item; for a video, call review_media with `times` in and around the changed part and go through its checklist; for an image, open it at phone size. Then call resolve_feedback with this feedback id and one line on what changed.",
  "Finish with a short, plain summary for someone who does not use video editors, written in the language of the request, as any question you ask is. If the request is unclear, ask instead of guessing. If you have the AskUserQuestion or request_user_input tool, ask with it: the user answers on the board and you go on in the same run. Otherwise leave the feedback open and end your reply with the question in this block; the board shows each `- ` line as an answer to pick with one click, and the user's answer comes back as the next request:",
  "```question",
  "Should the caption sit above or below the face?",
  "- Above",
  "- Below",
  "```",
  "Put two or three likely answers, and nothing after the block.",
];

/** The message an agent receives for one request, headless or pasted by the user. */
export const buildEditPrompt = Effect.fn("edits.buildEditPrompt")(function* (
  item: Item,
  f: Feedback,
) {
  const ws = yield* Workspace;

  const header = [
    `Edit request ${f.id} on content item "${item.id}" (${item.doc.title}) in the Cutfac workspace at ${ws.root}. Follow the cutfac skill.`,
    "",
    `Request: ${f.body}`,
    "",
  ];

  const answered = answerLines(item, f);
  const attachments = yield* attachmentLines(item, f);
  const references = yield* referenceLines(item);
  const format = Option.getOrUndefined(yield* itemFormat(item.doc.format));
  const notes = format === undefined ? undefined : yield* formatLines(format);
  const brief = yield* itemBriefLines(item, format, notes);
  const sources = yield* sourceLines(item);
  const purpose = yield* workspaceBriefLines();
  const about = yield* aboutLines();
  const target = yield* targetLines(item, f, format);

  return [
    ...header,
    ...answered,
    ...attachments,
    ...references,
    ...brief,
    ...sources,
    ...purpose,
    ...about,
    ...missingLines(notes),
    "Target:",
    ...target,
    ...versionLines(versionsWanted(f)),
    ...CLOSING_LINES,
  ].join("\n");
});
