import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { gridColumns, stepCard, stepOf } from "../web/src/lib/board-keys.ts";

// Drafting has three cards, review none, done two.
const BOARD = [["a", "b", "c"], [], ["x", "y"]];

describe("stepping through the board", () => {
  test("with no card to start from, the first card is the one", () => {
    expect(stepCard(BOARD, Option.none(), "down")).toEqual(Option.some("a"));
    expect(stepCard([[], ["x"]], Option.none(), "left")).toEqual(Option.some("x"));
    expect(stepCard(BOARD, Option.some("gone"), "up")).toEqual(Option.some("a"));
  });

  test("an empty board has nowhere to go", () => {
    expect(stepCard([[], []], Option.none(), "down")).toEqual(Option.none());
  });

  test("up and down stay in the column and stop at its ends", () => {
    expect(stepCard(BOARD, Option.some("a"), "down")).toEqual(Option.some("b"));
    expect(stepCard(BOARD, Option.some("b"), "up")).toEqual(Option.some("a"));
    expect(stepCard(BOARD, Option.some("a"), "up")).toEqual(Option.some("a"));
    expect(stepCard(BOARD, Option.some("c"), "down")).toEqual(Option.some("c"));
  });

  test("left and right skip empty columns and keep the height where they can", () => {
    expect(stepCard(BOARD, Option.some("b"), "right")).toEqual(Option.some("y"));
    expect(stepCard(BOARD, Option.some("c"), "right")).toEqual(Option.some("y"));
    expect(stepCard(BOARD, Option.some("x"), "left")).toEqual(Option.some("a"));
    expect(stepCard(BOARD, Option.some("y"), "left")).toEqual(Option.some("b"));
  });

  test("a step off the side stays put", () => {
    expect(stepCard(BOARD, Option.some("a"), "left")).toEqual(Option.some("a"));
    expect(stepCard(BOARD, Option.some("y"), "right")).toEqual(Option.some("y"));
  });

  test("J and K step like the arrows, whatever the input language", () => {
    expect(stepOf("KeyJ")).toEqual(Option.some("down"));
    expect(stepOf("KeyK")).toEqual(Option.some("up"));
    expect(stepOf("ArrowLeft")).toEqual(Option.some("left"));
    expect(stepOf("KeyH")).toEqual(Option.none());
  });
});

describe("stepping through the gallery", () => {
  // Five cards, three to a row: a b c / d e.
  const GRID = gridColumns(["a", "b", "c", "d", "e"], 3);

  test("cards go down their column row by row", () => {
    expect(GRID).toEqual([["a", "d"], ["b", "e"], ["c"]]);
  });

  test("up and down go a row, left and right along it", () => {
    expect(stepCard(GRID, Option.some("a"), "down")).toEqual(Option.some("d"));
    expect(stepCard(GRID, Option.some("e"), "up")).toEqual(Option.some("b"));
    expect(stepCard(GRID, Option.some("b"), "right")).toEqual(Option.some("c"));
    expect(stepCard(GRID, Option.some("d"), "left")).toEqual(Option.some("d"));
  });

  test("a gallery that cannot be measured is one column", () => {
    expect(gridColumns(["a", "b"], 0)).toEqual([["a", "b"]]);
  });
});
