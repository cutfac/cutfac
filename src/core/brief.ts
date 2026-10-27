import { Effect, Option, Schema } from "effect";
import { stringify } from "yaml";

import { fromYamlString } from "./configText.ts";
import { InvalidRequest } from "./errors.ts";
import { readOptionalText } from "./library.ts";
import { Workspace } from "./workspace.ts";

/**
 * What the workspace's videos are for and where they go, in the workspace root. The front matter
 * holds what the app reads; the body is the user's own words. The board and agents edit it alike.
 */
export const BRIEF_FILE = "brief.md";

/** What the videos are for. `own` leaves it to the body, in the user's words. */
export const PURPOSES = ["promote", "tips", "brand", "own"] as const;

export type Purpose = (typeof PURPOSES)[number];

/** Where the videos go. Each sets the aspect ratios and lengths that fit. */
export const PLATFORMS = ["tiktok", "shorts", "reels"] as const;

export type Platform = (typeof PLATFORMS)[number];

export interface Brief {
  readonly purpose?: Purpose | undefined;
  readonly platforms: ReadonlyArray<Platform>;
  /** The user's own words, as markdown. */
  readonly body: string;
}

/** A change to the brief: what it names is replaced, the rest kept. */
export const BriefPatch = Schema.Struct({
  purpose: Schema.optional(
    Schema.Literals(PURPOSES).annotate({
      description:
        "promote: the user's own product or service; tips: information and tips; " +
        "brand: the user's personal brand; own: what the body says",
    }),
  ),
  platforms: Schema.optional(
    Schema.Array(Schema.Literals(PLATFORMS)).annotate({
      description: "every platform the videos go on; replaces the list",
    }),
  ),
  body: Schema.optional(
    Schema.String.annotate({
      description: "the user's own words about the videos, as markdown; replaces the body",
    }),
  ),
});

export type BriefPatch = typeof BriefPatch.Type;

// The closing fence is a line of its own, so a value with `---` in it doesn't end the block.
const FRONT_MATTER = /^---\r?\n(?:([\s\S]*?)\r?\n)?---[^\S\n]*(?:\r?\n|$)/;

const isPurpose = Schema.is(Schema.Literals(PURPOSES));

const isPlatform = Schema.is(Schema.Literals(PLATFORMS));

/** Front matter fields as someone wrote them, before the app picks out what it knows. */
const FrontMatterFields = Schema.Record(Schema.String, Schema.Unknown);

type FrontMatterFields = typeof FrontMatterFields.Type;

// An empty block parses as null: no fields, which is fine.
const decodeFields = Schema.decodeUnknownOption(fromYamlString(Schema.NullOr(FrontMatterFields)));

interface FrontMatter {
  readonly fields: FrontMatterFields;
  /** The text after the front matter. */
  readonly rest: string;
  /** There is front matter, but not a YAML mapping, so its fields are unknown. */
  readonly broken: boolean;
}

/** The front matter as written, or nothing when it is missing or not a YAML mapping. */
function frontMatter(text: string): FrontMatter {
  const match = FRONT_MATTER.exec(text);

  if (match === null) return { fields: {}, rest: text, broken: false };

  const rest = text.slice(match[0].length);

  return Option.match(decodeFields(match[1] ?? ""), {
    onNone: () => ({ fields: {}, rest, broken: true }),
    onSome: (fields) => ({ fields: fields ?? {}, rest, broken: false }),
  });
}

/**
 * Read brief.md leniently, since people and agents write it by hand: a purpose or platform the app
 * doesn't know is left out rather than failing the whole file.
 */
export function parseBrief(text: string): Brief {
  const { fields, rest } = frontMatter(text);
  const platforms = Array.isArray(fields["platforms"]) ? fields["platforms"] : [];

  return {
    purpose: isPurpose(fields["purpose"]) ? fields["purpose"] : undefined,
    platforms: [...new Set(platforms.filter(isPlatform))],
    body: rest.trim(),
  };
}

/**
 * Write `brief` over `previous`, the file as it was: front matter keys the app doesn't know stay
 * as someone wrote them.
 */
export function formatBrief(brief: Brief, previous = ""): string {
  const { purpose: _purpose, platforms: _platforms, ...kept } = frontMatter(previous).fields;

  // YAML leaves out a key whose value is undefined, as the purpose is until someone picks one.
  const yaml = stringify(
    { purpose: brief.purpose, platforms: brief.platforms, ...kept },
    { lineWidth: 100 },
  ).trimEnd();

  const body = brief.body.trim();

  return `---\n${yaml}\n---\n${body === "" ? "" : `\n${body}\n`}`;
}

/** The brief, or nothing before anyone wrote one. */
export const readBrief = Effect.fn("brief.readBrief")(function* () {
  const text = yield* readOptionalText(BRIEF_FILE);

  return text === undefined ? undefined : parseBrief(text);
});

/** Change the brief, creating it when there is none, and answer with what it says now. */
export const updateBrief = Effect.fn("brief.updateBrief")(function* (patch: BriefPatch) {
  const ws = yield* Workspace;

  return yield* ws.exclusive(
    BRIEF_FILE,
    Effect.gen(function* () {
      const previous = (yield* readOptionalText(BRIEF_FILE)) ?? "";

      // Writing over front matter the app can't read would lose what it says.
      if (frontMatter(previous).broken) {
        return yield* new InvalidRequest({
          message: `${BRIEF_FILE} has front matter that isn't YAML. Fix it, then update the brief again.`,
        });
      }

      const current = parseBrief(previous);

      const next: Brief = {
        purpose: patch.purpose ?? current.purpose,
        platforms:
          patch.platforms === undefined ? current.platforms : [...new Set(patch.platforms)],
        body: patch.body ?? current.body,
      };

      yield* ws.writeText(BRIEF_FILE, formatBrief(next, previous));

      return next;
    }),
  );
});

const PURPOSE_TEXT: Record<Purpose, string> = {
  promote: "The videos promote the user's own product or service.",
  tips: "The videos share information and tips.",
  brand: "The videos build the user's personal brand.",
  own: "The user says what the videos are for in their own words.",
};

const PLATFORM_TEXT: Record<Platform, string> = {
  tiktok: "TikTok",
  shorts: "YouTube Shorts",
  reels: "Instagram Reels",
};

/** The brief as an agent reads it in a prompt: one line each for purpose and platforms. */
export function briefLines(brief: Brief): string[] {
  return [
    ...(brief.purpose === undefined ? [] : [PURPOSE_TEXT[brief.purpose]]),
    ...(brief.platforms.length === 0
      ? []
      : [`They go on ${brief.platforms.map((platform) => PLATFORM_TEXT[platform]).join(", ")}.`]),
  ];
}

/**
 * What an agent should know when the brief is missing. It doesn't block work: a request that says
 * what to make needs no brief, so the agent asks only when the answer matters.
 */
export function briefNotices(brief: Brief | undefined, path: string): string[] {
  if (brief !== undefined) return [];

  return [
    `${path} doesn't exist yet, so nothing says what this workspace's videos are for or where they go. ` +
      "When a task depends on that, ask the user, save the answer with update_brief, and go on.",
  ];
}
