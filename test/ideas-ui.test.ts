import { expect, test } from "bun:test";

import { Option } from "effect";

import { parseIdea } from "../web/src/lib/ideas.ts";

test("an idea line splits into its platform, length, title and what it shows", () => {
  expect(parseIdea(" shorts 20 | 말로 고치는 편집 | 장면을 고르고 말하면 바로 바뀌어요. ")).toEqual(
    {
      platform: Option.some("shorts"),
      seconds: Option.some(20),
      title: "말로 고치는 편집",
      about: Option.some("장면을 고르고 말하면 바로 바뀌어요."),
    },
  );
});

test("a line an earlier reading wrote, with no sentence, is still a title", () => {
  const idea = parseIdea("tiktok 15 | 박스 치고 말로 고친다");

  expect(idea.title).toBe("박스 치고 말로 고친다");
  expect(idea.about).toEqual(Option.none());
});

test("a line in another shape, or for an unknown platform, is all title", () => {
  expect(parseIdea("A 15-second TikTok on the app").platform).toEqual(Option.none());
  expect(parseIdea("snapchat 10 | A story").title).toBe("snapchat 10 | A story");
});
