import { Option, Schema } from "effect";

import type { NewVideoLink } from "../web/src/desktop.ts";
import { SCHEME } from "./boardPages.ts";

/** A link longer than this is turned away whole, rather than read in part. */
const MAX_LINK = 16_384;

/** The longest prompt a link may fill in; a longer one is turned away, not cut short. */
export const MAX_PROMPT = 8_000;

/** What a page that links to the app may call itself: a short lowercase name. */
const isSource = Schema.is(Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,39}$/)));

/** Control characters other than tab and newline, which a prompt has no use for. */
// oxlint-disable-next-line no-control-regex -- these are what it strips
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

const cleanPrompt = (text: string) => text.replaceAll("\r\n", "\n").replace(CONTROL, "").trim();

const isNewVideo = (link: URL) =>
  link.protocol === `${SCHEME}:` &&
  link.host === "new" &&
  (link.pathname === "" || link.pathname === "/");

/**
 * A `cutfac://new?prompt=…&source=…` link, as a web page opens the app with. Anything else, the
 * board's own `cutfac://app` pages included, isn't one; nor is a link with no prompt or one too long.
 */
export const parseAppLink = (url: string): Option.Option<NewVideoLink> =>
  Option.liftPredicate(url, (text) => text.length <= MAX_LINK).pipe(
    Option.flatMap((text) => Option.fromNullishOr(URL.parse(text))),
    Option.filter(isNewVideo),
    Option.flatMap((link) => {
      const prompt = cleanPrompt(link.searchParams.get("prompt") ?? "");

      if (prompt === "" || prompt.length > MAX_PROMPT) return Option.none();

      return Option.some(
        Option.match(
          Option.filter(Option.fromNullishOr(link.searchParams.get("source")), isSource),
          {
            onNone: (): NewVideoLink => ({ prompt }),
            onSome: (source): NewVideoLink => ({ prompt, source }),
          },
        ),
      );
    }),
  );
