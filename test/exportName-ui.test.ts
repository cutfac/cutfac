import { expect, test } from "bun:test";

import { exportName } from "../web/src/lib/exportName.ts";

const RENDER = "items/cutfac을-소개하는-15초/[9x16] cutfac을-소개하는-15초.mp4";

test("export suggests the video's title, not the name taken from the request", () => {
  expect(exportName("Cutfac 소개 15초", RENDER, false)).toBe("Cutfac 소개 15초.mp4");
});

test("a video with several files keeps each export apart by its aspect", () => {
  expect(exportName("Launch", "items/launch/[1x1] video.mp4", true)).toBe("Launch 1x1.mp4");
});

test("a title can't name a folder", () => {
  expect(exportName("Teaser: Before/after", RENDER, false)).toBe("Teaser - Before - after.mp4");
});

test("without a title, the file's own name goes, minus the board's aspect tag", () => {
  expect(exportName("  ", RENDER, false)).toBe("cutfac을-소개하는-15초.mp4");
});
