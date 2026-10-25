import { describe, expect, test } from "bun:test";

import { draftTitle, shownLink, withoutLink, writtenLinks } from "../web/src/lib/newVideo.ts";

describe("a new video from what the user wrote", () => {
  test("is titled from its first line, without links, cut at a word", () => {
    expect(draftTitle("\n  Show the  new reminders screen\nin 30 seconds")).toBe(
      "Show the new reminders screen",
    );
    expect(draftTitle("Like https://youtu.be/abc but about plants")).toBe("Like but about plants");
    expect(
      draftTitle("A thirty second video walking through the plant reminders, step by step"),
    ).toBe("A thirty second video walking through…");
    expect(draftTitle("https://youtu.be/abc")).toBeUndefined();
  });

  test("tells video links, which are downloaded, from pages, which are passed on", () => {
    expect(writtenLinks("like https://youtu.be/abc, see https://fernly.app.")).toEqual([
      { url: "https://youtu.be/abc", video: true },
      { url: "https://fernly.app", video: false },
    ]);
  });

  test("shows a link without its scheme", () => {
    expect(shownLink("https://www.youtube.com/shorts/abc")).toBe("youtube.com/shorts/abc");
    expect(shownLink("http://fernly.app/a?b=1")).toBe("fernly.app/a?b=1");
  });

  test("drops a link without leaving a gap", () => {
    expect(withoutLink("like https://youtu.be/abc but shorter", "https://youtu.be/abc")).toBe(
      "like but shorter",
    );
  });
});
