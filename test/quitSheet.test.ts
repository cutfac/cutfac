import { expect } from "bun:test";

import { Effect, Fiber, Ref } from "effect";
import { TestClock } from "effect/testing";

import { quitSheet } from "../electron/quitSheet.ts";
import { it } from "./effect.ts";

/** A sheet that keeps the signals it was shown with and answers when the test clicks it. */
const fakeSheet = () => {
  const shown: Array<AbortSignal> = [];
  const clicked = Promise.withResolvers<boolean>();

  const show = (signal: AbortSignal) => {
    shown.push(signal);

    return clicked.promise;
  };

  return { shown, show, click: (now: boolean) => Effect.sync(() => clicked.resolve(now)) };
};

it.effect("a quick quit shows no sheet, and a slower one's sheet closes as it ends", () =>
  Effect.gen(function* () {
    const sheet = fakeSheet();
    const quick = yield* Effect.forkChild(quitSheet(sheet.show, Effect.void));

    yield* TestClock.adjust("400 millis");
    yield* Fiber.interrupt(quick);

    expect(sheet.shown).toHaveLength(0);

    const slow = yield* Effect.forkChild(quitSheet(sheet.show, Effect.void));

    yield* TestClock.adjust("600 millis");

    expect(sheet.shown).toHaveLength(1);

    yield* Fiber.interrupt(slow);

    expect(sheet.shown[0]?.aborted).toBe(true);
  }),
);

it.effect("Quit Now in the sheet quits without waiting", () =>
  Effect.gen(function* () {
    const sheet = fakeSheet();
    const quitNow = yield* Ref.make(false);
    const waiting = yield* Effect.forkChild(quitSheet(sheet.show, Ref.set(quitNow, true)));

    yield* TestClock.adjust("600 millis");
    yield* sheet.click(true);
    yield* Fiber.join(waiting);

    expect(yield* Ref.get(quitNow)).toBe(true);
  }),
);
