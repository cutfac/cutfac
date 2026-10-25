import { describe, expect, test } from "bun:test";

import { isVideoLink, linksIn } from "../src/core/videoLinks.ts";

describe("video links", () => {
  test("video links are posts on video sites or video files", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abc",
      "https://youtube.com/shorts/abc",
      "https://m.youtube.com/live/abc",
      "https://youtu.be/abc",
      "https://www.tiktok.com/@fernly/video/123",
      "https://vm.tiktok.com/ZM123/",
      "https://www.instagram.com/reel/abc/",
      "https://vimeo.com/12345",
      "https://x.com/someone/status/123",
      "https://www.facebook.com/reel/123",
      "https://cdn.example.com/clip.mp4",
    ]) {
      expect(isVideoLink(link)).toBe(true);
    }

    for (const link of [
      "https://www.youtube.com/@fernly",
      "https://youtu.be/",
      "https://www.tiktok.com/@fernly",
      "https://www.instagram.com/fernly/",
      "https://vimeo.com/channels",
      "https://x.com/someone",
      "https://fernly.app/",
      "not a link",
    ]) {
      expect(isVideoLink(link)).toBe(false);
    }
  });

  test("links are found in text without the punctuation after them, each once", () => {
    expect(
      linksIn(
        "Like this (https://youtu.be/abc), and https://example.com/a?b=1. Again: https://youtu.be/abc",
      ),
    ).toEqual(["https://youtu.be/abc", "https://example.com/a?b=1"]);
    expect(linksIn("참고: https://www.tiktok.com/@a/video/123」 끝")).toEqual([
      "https://www.tiktok.com/@a/video/123",
    ]);
    expect(linksIn("no links, just www.example.com")).toEqual([]);
  });
});
