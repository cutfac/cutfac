import { describe, expect, test } from "bun:test";

import { stepCard, stepOf } from "../web/src/lib/board-keys.ts";

// Drafting has three cards, review none, done two.
const BOARD = [["a", "b", "c"], [], ["x", "y"]];

describe("stepping through the board", () => {
  test("with no card to start from, the first card is the one", () => {
    expect(stepCard(BOARD, undefined, "down")).toBe("a");
    expect(stepCard([[], ["x"]], undefined, "left")).toBe("x");
    expect(stepCard(BOARD, "gone", "up")).toBe("a");
  });

  test("an empty board has nowhere to go", () => {
    expect(stepCard([[], []], undefined, "down")).toBeUndefined();
  });

  test("up and down stay in the column and stop at its ends", () => {
    expect(stepCard(BOARD, "a", "down")).toBe("b");
    expect(stepCard(BOARD, "b", "up")).toBe("a");
    expect(stepCard(BOARD, "a", "up")).toBe("a");
    expect(stepCard(BOARD, "c", "down")).toBe("c");
  });

  test("left and right skip empty columns and keep the height where they can", () => {
    expect(stepCard(BOARD, "b", "right")).toBe("y");
    expect(stepCard(BOARD, "c", "right")).toBe("y");
    expect(stepCard(BOARD, "x", "left")).toBe("a");
    expect(stepCard(BOARD, "y", "left")).toBe("b");
  });

  test("a step off the side stays put", () => {
    expect(stepCard(BOARD, "a", "left")).toBe("a");
    expect(stepCard(BOARD, "y", "right")).toBe("y");
  });

  test("J and K step like the arrows, whatever the input language", () => {
    expect(stepOf("KeyJ")).toBe("down");
    expect(stepOf("KeyK")).toBe("up");
    expect(stepOf("ArrowLeft")).toBe("left");
    expect(stepOf("KeyH")).toBeUndefined();
  });
});
