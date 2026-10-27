import { describe, expect } from "bun:test";

import { Deferred, Effect, Fiber, Ref } from "effect";

import { quitQuestion } from "../electron/quitQuestion.ts";
import { it } from "./effect.ts";

const asked = Effect.fnUntraced(function* (work: number) {
  const busy = yield* Ref.make(work);
  const asks = yield* Ref.make(0);
  const answer = yield* Deferred.make<boolean>();

  const confirm = Effect.andThen(
    Ref.update(asks, (n) => n + 1),
    Deferred.await(answer),
  );

  return { question: yield* quitQuestion(Ref.get(busy), confirm), busy, asks, answer };
});

describe("asking before quitting", () => {
  it.effect("asks only while work goes on", () =>
    Effect.gen(function* () {
      const { question, busy } = yield* asked(0);

      expect(yield* question.mustAsk).toBe(false);

      yield* Ref.set(busy, 2);

      expect(yield* question.mustAsk).toBe(true);
    }),
  );

  it.effect("asks once while a question is up, the window's close and the quit sharing it", () =>
    Effect.gen(function* () {
      const { question, asks, answer } = yield* asked(1);

      const closing = yield* Effect.forkScoped(question.ask, { startImmediately: true });
      const quitting = yield* Effect.forkScoped(question.ask, { startImmediately: true });

      yield* Deferred.succeed(answer, false);

      expect([yield* Fiber.join(closing), yield* Fiber.join(quitting)]).toEqual([false, false]);
      expect(yield* Ref.get(asks)).toBe(1);
      expect(yield* question.mustAsk).toBe(true);
    }),
  );

  it.effect("asks no more once the person quits anyway, or something else quits the app", () =>
    Effect.gen(function* () {
      const answered = yield* asked(1);

      yield* Deferred.succeed(answered.answer, true);

      expect(yield* answered.question.ask).toBe(true);
      expect(yield* answered.question.mustAsk).toBe(false);

      const signalled = yield* asked(1);

      yield* signalled.question.settle;

      expect(yield* signalled.question.mustAsk).toBe(false);
    }),
  );
});
