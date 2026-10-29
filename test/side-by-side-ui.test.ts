import { expect, test } from "bun:test";

import { playWindows } from "../web/src/lib/side-by-side.ts";

test("each take of a part plays to its own end, shifted by how much longer or shorter it is", () => {
  expect(playWindows({ start: 12, end: 15 }, [15, 13.5, 16.5], 0)).toEqual([
    { start: 12, end: 15 },
    { start: 12, end: 13.5 },
    { start: 12, end: 16.5 },
  ]);
});

test("a take that cut the part away still starts with the others and stops at its end", () => {
  expect(playWindows({ start: 12, end: 15 }, [15, 12], 0)).toEqual([
    { start: 12, end: 15 },
    { start: 12, end: 12 },
  ]);
});

test("without a part, each plays from where the edit shows to its own end", () => {
  expect(playWindows({ start: 3 }, [15, 9], 0)).toEqual([
    { start: 3, end: 15 },
    { start: 3, end: 9 },
  ]);
  expect(playWindows({}, [15, 18], undefined)).toEqual([
    { start: 0, end: 15 },
    { start: 0, end: 18 },
  ]);
});
