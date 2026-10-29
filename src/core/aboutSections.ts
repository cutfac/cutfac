/**
 * How about.md is split into sections, with no file access, so the board reads the file the way
 * the core writes it.
 */

/** What about.md starts with before anything is learned or written. */
export const ABOUT_HEADER =
  "# About\n\nWhat this workspace makes videos about. Agents read this file before they work; anyone can edit it.\n";

/** Starts the line a new section carries until an agent has read its source. */
export const UNREAD = "> Not read yet";

/** The line under a section's heading that ties it to the learned entry it was written for. */
export const MARKER = /^<!-- learned:(\S+) -->$/;

export interface AboutSection {
  /** The learned entry it was written for, from its marker line; none for a section a person added. */
  readonly id?: string | undefined;
  /** Line indexes: from the heading up to, not including, `end`. */
  readonly start: number;
  readonly end: number;
  readonly unread: boolean;
}

/** about.md's `#` and `##` sections; deeper headings belong to the section they are in. */
export function aboutSections(about: string): ReadonlyArray<AboutSection> {
  const lines = about.split("\n");
  const starts = lines.flatMap((line, index) => (/^#{1,2} /.test(line) ? [index] : []));

  return starts.map((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start + 1, end);

    const id = body
      .map((line) => MARKER.exec(line.trim())?.[1])
      .find((found) => found !== undefined);

    return { id, start, end, unread: body.some((line) => line.startsWith(UNREAD)) };
  });
}
