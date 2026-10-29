import { ABOUT_HEADER, MARKER, UNREAD, aboutSections } from "../../../src/core/aboutSections.ts";

/** about.md split the way the Brief page shows it: beside each source, and the rest. */
export interface AboutParts {
  /** What was written for each learned entry, by its id, without its heading and marker. */
  readonly learned: ReadonlyMap<string, string>;
  /** Everything not written for a source, without the header every about.md starts with. */
  readonly notes: string;
}

/** The lines Cutfac writes under a source's heading to say where it came from, which the page shows itself. */
const SOURCE_LINE = /^- (Link|Folder|File|By|Also|Saved): |^- Uploaded file$/;

export function aboutParts(about: string): AboutParts {
  const lines = about.split("\n");
  const sections = aboutSections(about);
  const learned = new Map<string, string>();
  const rest = [lines.slice(0, sections[0]?.start ?? lines.length).join("\n")];

  for (const { id, start, end } of sections) {
    if (id === undefined) {
      rest.push(lines.slice(start, end).join("\n"));
      continue;
    }

    const body = lines
      .slice(start + 1, end)
      .filter(
        (line) => !MARKER.test(line.trim()) && !line.startsWith(UNREAD) && !SOURCE_LINE.test(line),
      );

    learned.set(id, body.join("\n").trim());
  }

  const notes = rest.join("\n").trim();
  const header = ABOUT_HEADER.trim();

  return { learned, notes: notes.startsWith(header) ? notes.slice(header.length).trim() : notes };
}
