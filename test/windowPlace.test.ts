import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { decodeWindowPlace, placeWindow } from "../electron/windowPlace.ts";

const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };

// A larger screen to the laptop's right.
const MONITOR = { x: 1512, y: -300, width: 2560, height: 1415 };

describe("placing the window again", () => {
  test("a window that still fits opens where it was", () => {
    const saved = { x: 100, y: 80, width: 1280, height: 800 };

    expect(placeWindow(saved, [LAPTOP, MONITOR])).toEqual(saved);
    expect(placeWindow({ ...saved, x: 2000 }, [LAPTOP, MONITOR])).toEqual({ ...saved, x: 2000 });
  });

  test("it opens on the screen it mostly sat on, pulled inside it", () => {
    expect(placeWindow({ x: 1300, y: 100, width: 1280, height: 800 }, [LAPTOP, MONITOR])).toEqual({
      x: 1512,
      y: 100,
      width: 1280,
      height: 800,
    });
  });

  test("a window bigger than its screen shrinks to it", () => {
    expect(placeWindow({ x: -100, y: 0, width: 2400, height: 1400 }, [LAPTOP])).toEqual(LAPTOP);
  });

  test("a window on a screen that is gone keeps its size, and the system places it", () => {
    expect(placeWindow({ x: 2000, y: 0, width: 1280, height: 800 }, [LAPTOP])).toEqual({
      width: 1280,
      height: 800,
    });
    expect(placeWindow({ x: 2000, y: 0, width: 2400, height: 1400 }, [LAPTOP])).toEqual({
      width: 1512,
      height: 920,
    });
  });

  test("a saved place from another version is ignored", () => {
    expect(Option.isNone(decodeWindowPlace({ x: 0, y: 0, width: 800 }))).toBe(true);
    expect(Option.isNone(decodeWindowPlace("1280x800"))).toBe(true);
    expect(decodeWindowPlace({ x: 0, y: 0, width: 800, height: 600, maximized: false })).toEqual(
      Option.some({ x: 0, y: 0, width: 800, height: 600, maximized: false }),
    );
  });
});
