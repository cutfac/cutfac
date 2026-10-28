import { Array, Option } from "effect";

import type { ItemSource } from "../api.ts";
import { linkLabel } from "./imports.ts";
import { urlOf } from "./utils.ts";

const decodedPath = Option.liftThrowable(decodeURIComponent);

/**
 * What the user typed or pasted, as a source: a link when it looks like one, else a path. The
 * server checks the rest, so a link it cannot take comes back with why.
 */
export function sourceOf(text: string): Option.Option<ItemSource> {
  const given = text.trim();

  if (given === "") return Option.none();

  // A file dragged out of Finder or a browser's address bar arrives as a file URL.
  if (/^file:\/\//i.test(given)) {
    return urlOf(given).pipe(
      Option.flatMap(({ pathname }) => decodedPath(pathname)),
      Option.map((path) => ({ path })),
    );
  }

  if (/^[a-z][a-z\d+.-]*:\/\//i.test(given)) return Option.some({ url: given });

  if (/^www\./i.test(given)) return Option.some({ url: `https://${given}` });

  return Option.some({ path: given });
}

/** A source as its chip shows it: what it is, a short name, and the whole of it. */
export interface SourceView {
  readonly kind: "folder" | "file" | "link";
  /** The last part of a path, or a link's host and path; none for the workspace itself. */
  readonly label: Option.Option<string>;
  readonly full: string;
}

/** Whether a path names a file, going by its name alone: nothing on disk is read. */
const looksLikeFile = (name: string) => /.\.[a-z\d]{1,8}$/i.test(name);

export function sourceView(source: ItemSource): SourceView {
  if ("url" in source) {
    return { kind: "link", label: Option.some(linkLabel(source.url)), full: source.url };
  }

  const name = Array.findLast(source.path.split(/[\\/]/), (part) => part !== "");

  return {
    kind: Option.exists(name, looksLikeFile) ? "file" : "folder",
    label:
      source.path === "." ? Option.none() : Option.orElse(name, () => Option.some(source.path)),
    full: source.path,
  };
}

/** What tells two sources apart, as the server compares them. */
export const sourceKey = (source: ItemSource) => ("url" in source ? source.url : source.path);
