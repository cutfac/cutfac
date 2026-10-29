import { expect, test } from "bun:test";

import { timeSpans } from "../web/src/lib/reply-times.ts";

const picked = (reply: string) =>
  timeSpans(reply).map(({ text, from, to }) => ({ text, from, to }));

test("scene ranges an agent writes in seconds or as clock times become picks", () => {
  expect(picked("- **0–2.5s:** title\n- 7.5 - 12 s: compare\n- 12~15초: logo")).toEqual([
    { text: "0–2.5s", from: 0, to: 2.5 },
    { text: "7.5 - 12 s", from: 7.5, to: 12 },
    { text: "12~15초", from: 12, to: 15 },
  ]);
  expect(picked("from 0:03.5–1:02 and again at 0:04")).toEqual([
    { text: "0:03.5–1:02", from: 3.5, to: 62 },
    { text: "0:04", from: 4, to: undefined },
  ]);
});

test("a length, a version number or a date is not a moment in the video", () => {
  expect(picked("The 15-second video, a 15s cut, 15초 영상, v1.2-3s, 2026-10-29")).toEqual([]);
});
