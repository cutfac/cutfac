import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { draftTitle } from "../web/src/lib/newVideo.ts";

describe("a new video from what the user wrote", () => {
  test("is titled from its first line, without links, cut at a word", () => {
    expect(draftTitle("\n  Show the  new reminders screen\nin 30 seconds")).toEqual(
      Option.some("Show the new reminders screen"),
    );
    expect(draftTitle("Like https://youtu.be/abc but about plants")).toEqual(
      Option.some("Like but about plants"),
    );
    expect(
      draftTitle("A thirty second video walking through the plant reminders, step by step"),
    ).toEqual(Option.some("A thirty second video walking through…"));
    expect(draftTitle("https://youtu.be/abc")).toEqual(Option.none());
  });
});
