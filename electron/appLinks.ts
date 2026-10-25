import type { NewVideoLink } from "../web/src/desktop.ts";
import { SCHEME } from "./boardPages.ts";

/** A link longer than this is turned away whole, rather than read in part. */
const MAX_LINK = 16_384;

/** The longest prompt a link may fill in; a longer one is turned away, not cut short. */
export const MAX_PROMPT = 8_000;

/** What a page that links to the app may call itself: a short lowercase name. */
const SOURCE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Control characters other than tab and newline, which a prompt has no use for. */
// oxlint-disable-next-line no-control-regex -- these are what it strips
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const cleanPrompt = (text: string) => text.replaceAll("\r\n", "\n").replace(CONTROL, "").trim();

/**
 * A `cutfac://new?prompt=…&source=…` link, as a web page opens the app with. Anything else, the
 * board's own `cutfac://app` pages included, isn't one; nor is a link with no prompt or one too long.
 */
export function parseAppLink(url: string): NewVideoLink | undefined {
  if (url.length > MAX_LINK) return undefined;

  const parsed = URL.parse(url);

  if (parsed?.protocol !== `${SCHEME}:` || parsed.host !== "new") return undefined;

  if (parsed.pathname !== "" && parsed.pathname !== "/") return undefined;

  const prompt = cleanPrompt(parsed.searchParams.get("prompt") ?? "");

  if (prompt === "" || prompt.length > MAX_PROMPT) return undefined;

  const source = parsed.searchParams.get("source");

  return source !== null && SOURCE.test(source) ? { prompt, source } : { prompt };
}
