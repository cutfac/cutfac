/** What the videos are for. `own` leaves it to the body, in the user's words. */
export const PURPOSES = ["promote", "tips", "brand", "own"] as const;

export type Purpose = (typeof PURPOSES)[number];

/** Where the videos go. Each sets the aspect ratios and lengths that fit. */
export const PLATFORMS = ["tiktok", "shorts", "reels", "other"] as const;

export type Platform = (typeof PLATFORMS)[number];

/** brief.md as the board edits it; `exists` is false until someone writes one. */
export interface BriefView {
  path: string;
  exists: boolean;
  purpose: Purpose | null;
  platforms: Platform[];
  body: string;
}

/** A change to the brief: what it names is replaced, the rest kept. */
export interface BriefPatch {
  purpose?: Purpose;
  platforms?: Platform[];
  body?: string;
}

/** What the brief's form edits: the purpose, the platforms and the user's own words. */
export type BriefDraft = Pick<BriefView, "purpose" | "platforms" | "body">;

export const EMPTY_BRIEF: BriefDraft = { purpose: null, platforms: [], body: "" };

/** Whether the form says enough to make a template from: a purpose, and for `own` its words. */
export const briefReady = ({ purpose, body }: BriefDraft) =>
  purpose !== null && (purpose !== "own" || body.trim() !== "");

/** The change that saves the form. A purpose not picked yet is left as it is. */
export const briefPatch = ({ purpose, platforms, body }: BriefDraft): BriefPatch => ({
  ...(purpose !== null && { purpose }),
  platforms,
  body: body.trim(),
});

/** How the sidebar's line names each purpose, by its short name, and each platform. */
export interface BriefLabels {
  purpose: Record<Purpose, { short: string }>;
  platform: Record<Platform, string>;
}

/**
 * The brief summed up in a line, such as "Promotion · TikTok, Shorts": the purpose, or the body's
 * first line when the purpose is the user's own words, then the platforms. Empty when it says
 * nothing.
 */
export function briefLine(brief: BriefDraft, labels: BriefLabels): string {
  const firstLine = brief.body.trim().split("\n")[0]?.trim() ?? "";

  const what =
    brief.purpose === null || brief.purpose === "own"
      ? firstLine
      : labels.purpose[brief.purpose].short;

  const where = PLATFORMS.flatMap((platform) =>
    brief.platforms.includes(platform) ? [labels.platform[platform]] : [],
  ).join(", ");

  return [what, where].filter((part) => part !== "").join(" · ");
}
