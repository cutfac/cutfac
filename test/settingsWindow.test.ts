import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { decodeFrameLine } from "../electron/settingsWindow.ts";

describe("decodeFrameLine", () => {
  test("reads the window's frame", () => {
    expect(decodeFrameLine('{"x":398,"y":241,"width":740,"height":766}')).toEqual(
      Option.some({ x: 398, y: 241, width: 740, height: 766 }),
    );
  });

  test("reads that System Settings has no window on screen", () => {
    expect(decodeFrameLine("null")).toEqual(Option.some(null));
  });

  test("skips a line cut off as the script stops, or with a part missing", () => {
    expect(decodeFrameLine('{"x":398,"y":2')).toEqual(Option.none());
    expect(decodeFrameLine('{"x":398,"y":241,"width":740}')).toEqual(Option.none());
  });
});
