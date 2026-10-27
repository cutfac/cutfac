import { describe, expect, test } from "bun:test";

import { Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { awaitGrant, helperBounds } from "../electron/accessWatch.ts";
import { it } from "./effect.ts";

const SCREEN = { x: 0, y: 25, width: 1512, height: 920 };

describe("placing the drag helper", () => {
  test.each([
    {
      name: "under the window, lined up with the list beside its sidebar",
      frame: { x: 300, y: 100, width: 780, height: 600 },
      bounds: { x: 530, y: 710, width: 550, height: 72 },
    },
    {
      name: "as wide as its own content when the list is narrower",
      frame: { x: 300, y: 100, width: 600, height: 600 },
      bounds: { x: 530, y: 710, width: 440, height: 72 },
    },
    {
      name: "inside the screen when the window reaches its bottom",
      frame: { x: 300, y: 300, width: 780, height: 640 },
      bounds: { x: 530, y: 863, width: 550, height: 72 },
    },
    {
      name: "inside the screen when the window reaches its right edge",
      frame: { x: 1200, y: 100, width: 780, height: 600 },
      bounds: { x: 952, y: 710, width: 550, height: 72 },
    },
  ])("goes $name", ({ frame, bounds }) => {
    expect(helperBounds(frame, SCREEN)).toEqual(bounds);
  });
});

describe("waiting for a permission", () => {
  it.effect("checks every second until the permission is granted", () =>
    Effect.gen(function* () {
      const checks = yield* Ref.make(0);
      const granted = Ref.updateAndGet(checks, (n) => n + 1).pipe(Effect.map((n) => n === 3));
      const waiting = yield* Effect.forkScoped(awaitGrant(granted));

      yield* TestClock.adjust("1 second");

      expect(waiting.pollUnsafe()).toBeUndefined();

      yield* TestClock.adjust("1 second");

      expect(yield* Fiber.join(waiting)).toEqual(Option.some(true));
      expect(yield* Ref.get(checks)).toBe(3);
    }),
  );

  it.effect("gives up after ten minutes without it", () =>
    Effect.gen(function* () {
      const waiting = yield* Effect.forkScoped(awaitGrant(Effect.succeed(false)));

      yield* TestClock.adjust("10 minutes");

      expect(yield* Fiber.join(waiting)).toEqual(Option.none());
    }),
  );
});
