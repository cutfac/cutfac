import { Effect, Option, Path } from "effect";

import { envVar } from "./env.ts";
import { InvalidRequest } from "./errors.ts";
import { carriesSecret } from "./links.ts";
import type { ItemSource } from "./schema.ts";
import { Workspace } from "./workspace.ts";

/** Enough to point an item at what it builds on, few enough to list in every edit prompt. */
export const MAX_SOURCES = 20;

/** What tells two sources apart: the link, or the path as stored. */
const sourceKey = (source: ItemSource) => ("url" in source ? source.url : source.path);

/** The hosts of an item's web pages, which an edit run may read from. */
export const sourceHosts = (sources: ReadonlyArray<ItemSource>) => [
  ...new Set(sources.flatMap((source) => ("url" in source ? [new URL(source.url).hostname] : []))),
];

/** An http(s) link with no login or token in it, in its canonical form. */
export function cleanUrl(text: string) {
  const url = URL.parse(text.trim());

  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return Effect.fail(new InvalidRequest({ message: "A source link must start with http(s)://" }));
  }

  if (carriesSecret(url.href)) {
    return Effect.fail(
      new InvalidRequest({ message: "That link carries a login or token; use one without it" }),
    );
  }

  return Effect.succeed(url.href);
}

/**
 * An absolute path, `~/…`, or a path relative to the workspace, made absolute; one inside the
 * workspace is kept relative so the workspace can move. Nothing is read: whatever is there may
 * change, and the agent says when it is gone.
 */
export const cleanPath = Effect.fnUntraced(function* (text: string) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  let given = text.trim();

  if (given === "") {
    return yield* new InvalidRequest({ message: "A source needs a path or a link" });
  }

  if (given === "~" || given.startsWith("~/")) {
    const home = yield* envVar("HOME");

    if (Option.isNone(home)) {
      return yield* new InvalidRequest({ message: `Write the full path instead of ${given}` });
    }

    given = home.value + given.slice(1);
  }

  const full = path.resolve(ws.root, given);
  const rel = path.relative(ws.root, full);
  const outside = rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);

  if (outside) return full;

  return rel === "" ? "." : ws.rel(full);
});

/** Check and tidy the sources a user or agent gave, keeping the first of any repeats. */
export const cleanSources = Effect.fn("sources.cleanSources")(function* (
  sources: ReadonlyArray<ItemSource>,
) {
  const cleaned = yield* Effect.forEach(sources, (source) =>
    "url" in source
      ? Effect.map(cleanUrl(source.url), (url): ItemSource => ({ url }))
      : Effect.map(cleanPath(source.path), (path): ItemSource => ({ path })),
  );

  // A source is all key, so the map keeps the first of each in order.
  const unique = [...new Map(cleaned.map((source) => [sourceKey(source), source])).values()];

  if (unique.length > MAX_SOURCES) {
    return yield* new InvalidRequest({
      message: `An item can point at up to ${MAX_SOURCES} sources`,
    });
  }

  return unique;
});
