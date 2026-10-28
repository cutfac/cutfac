import { expect, test } from "bun:test";

import type { KeyboardEvent } from "react";

import { sendOnEnter } from "../web/src/lib/utils.ts";

interface Press {
  readonly key: string;
  readonly shiftKey?: boolean;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

/** What a text box did with one key press. */
const outcome = (press: Press) => {
  const done: Array<string> = [];

  // SAFETY: the handler reads only these fields of a React keyboard event.
  const event = {
    key: press.key,
    shiftKey: press.shiftKey ?? false,
    keyCode: press.keyCode ?? 0,
    nativeEvent: { isComposing: press.isComposing ?? false },
    preventDefault: () => {
      done.push("prevented");
    },
  } as KeyboardEvent<HTMLElement>;

  const onKeyDown = sendOnEnter({
    onEnter: () => done.push("sent"),
    onEscape: () => done.push("escaped"),
  });

  onKeyDown(event);

  return done;
};

test("Enter sends, Shift+Enter is left to the box for a new line, and Escape leaves", () => {
  expect(outcome({ key: "Enter" })).toEqual(["prevented", "sent"]);
  expect(outcome({ key: "Enter", shiftKey: true })).toEqual([]);
  expect(outcome({ key: "Escape" })).toEqual(["escaped"]);
});

test("Enter that confirms a syllable an IME is composing sends nothing", () => {
  expect(outcome({ key: "Enter", isComposing: true })).toEqual([]);
  // Safari ends a composition with a keydown that says 229 instead.
  expect(outcome({ key: "Enter", keyCode: 229 })).toEqual([]);
});
