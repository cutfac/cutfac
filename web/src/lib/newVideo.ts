import { isVideoLink, linksIn } from "../../../src/core/videoLinks.ts";

/** Longest title taken from what the user wrote, before it is cut at a word. */
const MAX_TITLE = 40;

/** A link in what the user wrote: a video is downloaded into the item, a page is only passed on. */
export interface WrittenLink {
  url: string;
  video: boolean;
}

/** The links in what the user wrote, each once, telling videos from pages. */
export const writtenLinks = (text: string): ReadonlyArray<WrittenLink> =>
  linksIn(text).map((url) => ({ url, video: isVideoLink(url) }));

/** A link as people read it, such as `youtube.com/shorts/abc`, without its scheme or `www.`. */
export const shownLink = (url: string): string => url.replace(/^https?:\/\/(www\.)?/, "");

/** `text` without `link`, and without the gap it leaves. */
export function withoutLink(text: string, link: string): string {
  return text
    .split(link)
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+$/gm, "")
    .trim();
}

/**
 * A provisional title from what the user wrote: its first line without links, cut at a word past
 * {@link MAX_TITLE} characters. Undefined when there is nothing but links. The agent gives the item
 * a fitting title once it knows what the video is.
 */
export function draftTitle(text: string): string | undefined {
  const plain = linksIn(text).reduce((rest, link) => rest.split(link).join(" "), text);

  const line = plain
    .split("\n")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .find((part) => part !== "");

  if (line === undefined || line.length <= MAX_TITLE) return line;

  const cut = line.slice(0, MAX_TITLE);
  const space = cut.lastIndexOf(" ");
  const word = space > MAX_TITLE / 2 ? cut.slice(0, space) : cut;

  return `${word.replace(/[\s,.;:!?·-]+$/u, "")}…`;
}
