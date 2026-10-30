import { Array, Option } from "effect";

import { linksIn } from "../../../src/core/videoLinks.ts";

/** Longest title taken from what the user wrote, before it is cut at a word. */
const MAX_TITLE = 40;

/**
 * A provisional title from what the user wrote: its first line without links, cut at a word past
 * {@link MAX_TITLE} characters. None when there is nothing but links. The agent gives the item a
 * fitting title once it knows what the video is.
 */
export function draftTitle(text: string): Option.Option<string> {
  const plain = linksIn(text).reduce((rest, link) => rest.split(link).join(" "), text);

  const line = Array.findFirst(
    plain.split("\n").map((part) => part.replace(/\s+/g, " ").trim()),
    (part) => part !== "",
  );

  return Option.map(line, (first) => {
    if (first.length <= MAX_TITLE) return first;

    const cut = first.slice(0, MAX_TITLE);
    const space = cut.lastIndexOf(" ");
    const word = space > MAX_TITLE / 2 ? cut.slice(0, space) : cut;

    return `${word.replace(/[\s,.;:!?·-]+$/u, "")}…`;
  });
}

const drafts = new Map<string, string>();

/** Leave `text` in the composer of the video `id`, for when its editor opens. */
export const holdDraft = (id: string, text: string) => void drafts.set(id, text);

/** What waits in the composer of the video `id`, if anything. */
export const draftFor = (id: string): string => drafts.get(id) ?? "";

export const forgetDraft = (id: string) => void drafts.delete(id);
