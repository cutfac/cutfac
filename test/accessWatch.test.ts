import { describe, expect } from "bun:test";

import { Effect, Fiber, Option, Ref } from "effect";
import { TestClock } from "effect/testing";

import { awaitGrant } from "../electron/accessWatch.ts";
import { it } from "./effect.ts";

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
