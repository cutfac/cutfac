import { expect, test } from "bun:test";

import { accessProgress } from "../web/src/lib/access.ts";

test("with nothing granted, screen recording is next and nothing waits", () => {
  expect(accessProgress({}, undefined)).toEqual({
    waiting: undefined,
    next: "screen",
    allGranted: false,
  });
});

test("a permission whose list was opened waits until it is granted", () => {
  expect(accessProgress({}, "accessibility").waiting).toBe("accessibility");
  expect(accessProgress({ accessibility: true }, "accessibility").waiting).toBeUndefined();
});

test("the next one to turn on skips what is already granted", () => {
  expect(accessProgress({ screen: true }, undefined).next).toBe("accessibility");
  expect(accessProgress({ accessibility: true }, "screen")).toEqual({
    waiting: "screen",
    next: "screen",
    allGranted: false,
  });
});

test("the step is done once both are granted, whichever list was opened last", () => {
  expect(accessProgress({ screen: true, accessibility: true }, "screen")).toEqual({
    waiting: undefined,
    next: undefined,
    allGranted: true,
  });
});
