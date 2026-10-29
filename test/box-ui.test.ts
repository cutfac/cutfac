import { expect, test } from "bun:test";

import { MIN_BOX, editBox } from "../web/src/lib/box.ts";

const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.2 };

test("moving a box keeps its size and stops at the frame's edges", () => {
  expect(editBox(box, "move", 0.1, -0.1)).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.2 });
  expect(editBox(box, "move", 0.9, 0.9)).toEqual({ x: 0.6, y: 0.8, w: 0.4, h: 0.2 });
});

test("dragging a corner moves only that corner, inside the frame", () => {
  expect(editBox(box, "nw", -0.1, -0.1)).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  expect(editBox(box, "se", 0.9, 0.9)).toEqual({ x: 0.2, y: 0.3, w: 0.8, h: 0.7 });
});

test("a corner dragged past the opposite one leaves the smallest box, not a flipped one", () => {
  expect(editBox(box, "ne", -1, 1)).toEqual({ x: 0.2, y: 0.48, w: MIN_BOX, h: MIN_BOX });
});

test("dragging an edge moves only that edge", () => {
  expect(editBox(box, "n", 0.1, 0.05)).toEqual({ x: 0.2, y: 0.35, w: 0.4, h: 0.15 });
  expect(editBox(box, "e", 0.1, 0.05)).toEqual({ x: 0.2, y: 0.3, w: 0.5, h: 0.2 });
});
