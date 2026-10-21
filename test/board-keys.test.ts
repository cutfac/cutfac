import { describe, expect, test } from "bun:test";

import { gridColumns, stepCard, stepOf } from "../web/src/lib/board-keys.ts";

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

describe("stepping through the gallery", () => {
  // Five cards, three to a row: a b c / d e.
  const GRID = gridColumns(["a", "b", "c", "d", "e"], 3);

  test("cards go down their column row by row", () => {
    expect(GRID).toEqual([["a", "d"], ["b", "e"], ["c"]]);
  });

  test("up and down go a row, left and right along it", () => {
    expect(stepCard(GRID, "a", "down")).toBe("d");
    expect(stepCard(GRID, "e", "up")).toBe("b");
    expect(stepCard(GRID, "b", "right")).toBe("c");
    expect(stepCard(GRID, "d", "left")).toBe("d");
  });

  test("a gallery that cannot be measured is one column", () => {
    expect(gridColumns(["a", "b"], 0)).toEqual([["a", "b"]]);
  });
});
