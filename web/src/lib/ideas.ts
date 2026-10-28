import { Option, Schema } from "effect";

import { PLATFORMS, type Platform } from "./brief.ts";

/** A first video the agent suggests: where it goes, how long it runs, and what it shows. */
export interface Idea {
  readonly platform: Option.Option<Platform>;
  readonly seconds: Option.Option<number>;
  readonly title: string;
}

const LINE = /^(\S+)\s+(\d{1,3})\s*\|\s*(.+)$/;

const decodePlatform = Schema.decodeUnknownOption(Schema.Literals(PLATFORMS));

/**
 * An `ideas` line as the reading writes it, `tiktok 15 | what it shows`; a line in any other shape
 * is all title.
 */
export function parseIdea(line: string): Idea {
  const text = line.trim();
  const match = LINE.exec(text);
  const platform = decodePlatform(match?.[1]?.toLowerCase());

  if (match === null || Option.isNone(platform)) {
    return { platform: Option.none(), seconds: Option.none(), title: text };
  }

  return {
    platform,
    seconds: Option.some(Number(match[2])),
    title: (match[3] ?? "").trim(),
  };
}
