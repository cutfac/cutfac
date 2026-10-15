import type { ItemSource } from "../api.ts";
import { linkLabel } from "./imports.ts";

/**
 * What the user typed or pasted, as a source: a link when it looks like one, else a path. The
 * server checks the rest, so a link it cannot take comes back with why.
 */
export function sourceOf(text: string): ItemSource | undefined {
  const given = text.trim();

  if (given === "") return undefined;

  // A file dragged out of Finder or a browser's address bar arrives as a file URL.
  if (/^file:\/\//i.test(given)) return { path: decodeURIComponent(new URL(given).pathname) };

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(given)) return { url: given };

  if (/^www\./i.test(given)) return { url: `https://${given}` };

  return { path: given };
}

/** A source as its chip shows it: what it is, a short name, and the whole of it. */
export interface SourceView {
  readonly kind: "folder" | "file" | "link";
  /** The last part of a path, or a link's host and path; undefined for the workspace itself. */
  readonly label: string | undefined;
  readonly full: string;
}

/** Whether a path names a file, going by its name alone: nothing on disk is read. */
const looksLikeFile = (name: string) => /.\.[a-z\d]{1,8}$/i.test(name);

export function sourceView(source: ItemSource): SourceView {
  if ("url" in source) return { kind: "link", label: linkLabel(source.url), full: source.url };

  const name = source.path.split(/[\\/]/).findLast((part) => part !== "");
  const label = source.path === "." ? undefined : (name ?? source.path);

  return {
    kind: name !== undefined && looksLikeFile(name) ? "file" : "folder",
    label,
    full: source.path,
  };
}

/** What tells two sources apart, as the server compares them. */
export const sourceKey = (source: ItemSource) => ("url" in source ? source.url : source.path);
