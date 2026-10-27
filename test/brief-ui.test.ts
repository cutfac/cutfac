import { describe, expect, test } from "bun:test";

import * as core from "../src/core/brief.ts";
import {
  briefLine,
  briefPatch,
  briefReady,
  EMPTY_BRIEF,
  PLATFORMS,
  PURPOSES,
  type BriefDraft,
  type BriefLabels,
} from "../web/src/lib/brief.ts";

const labels: BriefLabels = {
  purpose: {
    promote: { short: "Promotion" },
    tips: { short: "Tips" },
    brand: { short: "Personal brand" },
    own: { short: "Your own" },
  },
  platform: { tiktok: "TikTok", shorts: "Shorts", reels: "Reels", other: "Other" },
};

const draft = (rest: Partial<BriefDraft>): BriefDraft => ({ ...EMPTY_BRIEF, ...rest });

describe("whether the brief says enough to start", () => {
  test("not before a purpose is picked", () => {
    expect(briefReady(EMPTY_BRIEF)).toBe(false);
  });

  test("a picked purpose is enough, with or without words", () => {
    expect(briefReady(draft({ purpose: "promote" }))).toBe(true);
  });

  test("the user's own purpose needs their words", () => {
    expect(briefReady(draft({ purpose: "own", body: "  " }))).toBe(false);
    expect(briefReady(draft({ purpose: "own", body: "Lyric videos for my band" }))).toBe(true);
  });
});

describe("the change that saves the brief", () => {
  test("leaves the purpose alone until one is picked", () => {
    expect(briefPatch(draft({ platforms: ["reels"] }))).toEqual({ platforms: ["reels"], body: "" });
  });

  test("trims the user's words", () => {
    expect(briefPatch(draft({ purpose: "tips", body: "  Quick recipes \n" }))).toEqual({
      purpose: "tips",
      platforms: [],
      body: "Quick recipes",
    });
  });
});

describe("the brief in a line", () => {
  test("names the purpose and the platforms in their own order", () => {
    const line = briefLine(draft({ purpose: "promote", platforms: ["reels", "tiktok"] }), labels);

    expect(line).toBe("Promotion · TikTok, Reels");
  });

  test("the user's own purpose reads as the first line of their words", () => {
    const brief = draft({
      purpose: "own",
      body: "Lyric videos\nfor my band",
      platforms: ["shorts"],
    });

    expect(briefLine(brief, labels)).toBe("Lyric videos · Shorts");
  });

  test("is empty when the brief says nothing", () => {
    expect(briefLine(EMPTY_BRIEF, labels)).toBe("");
  });
});

test("the board offers the purposes and platforms the server takes", () => {
  expect(PURPOSES).toEqual(core.PURPOSES);
  expect(PLATFORMS).toEqual(core.PLATFORMS);
});
