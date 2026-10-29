import { Effect, Option } from "effect";

import { ABOUT_HEADER, UNREAD, aboutSections } from "./aboutSections.ts";
import { type LearnedDoc } from "./learnedSchema.ts";
import { clip } from "./learnText.ts";
import { readOptionalText } from "./library.ts";
import { Workspace } from "./workspace.ts";

export { UNREAD, aboutSections } from "./aboutSections.ts";

/** What the workspace makes videos about, in the workspace root. Agents read it; anyone edits it. */
export const ABOUT_FILE = "about.md";

const UNREAD_LINE = `${UNREAD}: an agent should read the source, rewrite this section with what matters for the videos, and delete this line.`;

const marker = (id: string) => `<!-- learned:${id} -->`;

/** How much of a description goes into about.md; learned.yaml keeps all of it. */
const SECTION_TEXT = 1200;

/** The section of about.md a new entry starts with, for an agent to rewrite once it has read the source. */
export function aboutSection(id: string, dir: string, doc: LearnedDoc): string {
  const where =
    doc.source === undefined
      ? "- Uploaded file"
      : "url" in doc.source
        ? `- Link: ${doc.source.url}`
        : `- ${doc.kind === "folder" ? "Folder" : "File"}: ${doc.source.path}`;

  // A line starting with # in the text would read as a heading and split the section.
  const text = clip(doc.description.trim(), SECTION_TEXT).replace(/^#/gm, "\\#");

  return [
    `## ${doc.title}`,
    marker(id),
    UNREAD_LINE,
    "",
    where,
    ...(doc.site === undefined ? [] : [`- By: ${doc.site}`]),
    ...(doc.links.length === 0 ? [] : [`- Also: ${doc.links.join(", ")}`]),
    `- Saved: ${dir}/`,
    ...(text === "" ? [] : ["", text]),
  ].join("\n");
}

export const addSection = Effect.fnUntraced(function* (id: string, dir: string, doc: LearnedDoc) {
  const ws = yield* Workspace;

  yield* ws.exclusive(
    ABOUT_FILE,
    Effect.gen(function* () {
      const about = (yield* readOptionalText(ABOUT_FILE)) ?? ABOUT_HEADER;
      yield* ws.writeText(ABOUT_FILE, `${about.trimEnd()}\n\n${aboutSection(id, dir, doc)}\n`);
    }),
  );
});

export const removeSection = Effect.fnUntraced(function* (id: string) {
  const ws = yield* Workspace;

  yield* ws.exclusive(
    ABOUT_FILE,
    Effect.gen(function* () {
      const about = yield* readOptionalText(ABOUT_FILE);

      if (about === undefined) return;
      const kept = withoutSection(about, id);

      if (kept !== about) yield* ws.writeText(ABOUT_FILE, kept);
    }),
  );
});

function withoutSection(about: string, id: string): string {
  const section = aboutSections(about).find((found) => found.id === id);

  if (section === undefined) return about;
  const lines = about.split("\n");

  return `${[...lines.slice(0, section.start), ...lines.slice(section.end)].join("\n").trimEnd()}\n`;
}

/** The ids of learned entries whose section no agent has rewritten yet. */
export const unreadIds = Effect.map(
  readOptionalText(ABOUT_FILE),
  (about) =>
    new Set(
      aboutSections(about ?? "").flatMap((section) =>
        section.unread && section.id !== undefined ? [section.id] : [],
      ),
    ),
);

export interface About {
  readonly path: string;
  readonly text: string;
}

/** about.md with its absolute path, for agents; none until something is learned or written. */
export const readAbout = Effect.fn("learn.readAbout")(function* () {
  const ws = yield* Workspace;
  const text = yield* readOptionalText(ABOUT_FILE);

  if (text === undefined) return Option.none<About>();

  return Option.some<About>({ path: yield* ws.abs(ABOUT_FILE), text });
});
