import { describe, expect, test } from "bun:test";

import { feedbackUrl } from "../web/src/lib/feedback.ts";

const context = { version: "0.1.0", locale: "ko-KR", platform: "macOS 15.4.0" };

describe("feedbackUrl", () => {
  test("links to the form with the context as hidden fields", () => {
    const url = new URL(feedbackUrl("wQ8bKl", context) ?? "");

    expect(url.origin).toBe("https://tally.so");
    expect(url.pathname).toBe("/r/wQ8bKl");
    expect(Object.fromEntries(url.searchParams)).toEqual(context);
  });

  test("encodes values that aren't URL-safe", () => {
    const url = feedbackUrl("wQ8bKl", { ...context, platform: "Linux 6.8 & co" });

    expect(url).toContain("platform=Linux+6.8+%26+co");
  });

  test("trims the configured id", () => {
    expect(feedbackUrl("  wQ8bKl\n", context)).toStartWith("https://tally.so/r/wQ8bKl?");
  });

  test("has no link when the form isn't configured or the id isn't a form id", () => {
    expect(feedbackUrl(undefined, context)).toBeUndefined();
    expect(feedbackUrl("", context)).toBeUndefined();
    expect(feedbackUrl("../evil", context)).toBeUndefined();
    expect(feedbackUrl("https://tally.so/r/wQ8bKl", context)).toBeUndefined();
  });
});
