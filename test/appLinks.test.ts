import { describe, expect, test } from "bun:test";

import { MAX_PROMPT, parseAppLink } from "../electron/appLinks.ts";

const link = (prompt: string, rest = "") =>
  `cutfac://new?prompt=${encodeURIComponent(prompt)}${rest}`;

describe("parseAppLink", () => {
  test("reads the prompt and who linked to it", () => {
    expect(
      parseAppLink(link("A 10s motion graphic: 오픈 기념", "&source=motion-graphics")),
    ).toEqual({
      prompt: "A 10s motion graphic: 오픈 기념",
      source: "motion-graphics",
    });
    expect(parseAppLink("cutfac://new/?prompt=Hi")).toEqual({ prompt: "Hi" });
  });

  test("keeps the prompt's lines and drops other control characters", () => {
    expect(parseAppLink(link("  First\r\nsecond\u0000\t!  "))).toEqual({
      prompt: "First\nsecond\t!",
    });
  });

  test("leaves out a source that isn't a short name", () => {
    expect(parseAppLink(link("Hi", "&source=Not%20a%20name"))).toEqual({ prompt: "Hi" });
    expect(parseAppLink(link("Hi", `&source=${"a".repeat(41)}`))).toEqual({ prompt: "Hi" });
  });

  test("is none without a prompt", () => {
    expect(parseAppLink("cutfac://new")).toBeUndefined();
    expect(parseAppLink("cutfac://new?source=motion-graphics")).toBeUndefined();
    expect(parseAppLink(link("   \n "))).toBeUndefined();
  });

  test("is none for another host, path or scheme, the board's own pages included", () => {
    expect(parseAppLink("cutfac://app/")).toBeUndefined();
    expect(parseAppLink(`cutfac://app/#/welcome?prompt=Hi`)).toBeUndefined();
    expect(parseAppLink("cutfac://open?prompt=Hi")).toBeUndefined();
    expect(parseAppLink("cutfac://new/item?prompt=Hi")).toBeUndefined();
    expect(parseAppLink("https://new?prompt=Hi")).toBeUndefined();
    expect(parseAppLink("not a link")).toBeUndefined();
  });

  test("is none for a prompt or a link too long, rather than cut short", () => {
    expect(parseAppLink(link("a".repeat(MAX_PROMPT)))?.prompt).toHaveLength(MAX_PROMPT);
    expect(parseAppLink(link("a".repeat(MAX_PROMPT + 1)))).toBeUndefined();
    expect(parseAppLink(link("Hi", `&pad=${"a".repeat(20_000)}`))).toBeUndefined();
  });
});
