import { expect, test } from "bun:test";

import { Option } from "effect";

import { parseIdea } from "../web/src/lib/ideas.ts";

test("an idea line splits into its platform, length and what it shows", () => {
  expect(parseIdea(" tiktok 15 | 박스 치고 말로 고친다 ")).toEqual({
    platform: Option.some("tiktok"),
    seconds: Option.some(15),
    title: "박스 치고 말로 고친다",
  });
});

test("a line in another shape, or for an unknown platform, is all title", () => {
  expect(parseIdea("A 15-second TikTok on the app").platform).toEqual(Option.none());
  expect(parseIdea("snapchat 10 | A story").title).toBe("snapchat 10 | A story");
});
