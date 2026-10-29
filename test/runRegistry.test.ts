// @effect-diagnostics strictEffectProvide:off
import { describe, expect } from "bun:test";

import { Deferred, Effect, Fiber, Option, Stream } from "effect";
import { TestClock } from "effect/testing";

import { type RunEvent } from "../src/core/agentParse.ts";
import { type RunInput, editRuns } from "../src/core/agentRun.ts";
import { Conflict } from "../src/core/errors.ts";
import { type RunSpec, type Runner, makeRunRegistry } from "../src/core/runRegistry.ts";
import { eventually, it } from "./effect.ts";
import { warnings } from "./support.ts";

const itemRuns = <R>(runner: Runner<RunInput, R>): RunSpec<RunInput, R> => {
  const { key, subject, busy } = editRuns(runner);

  return { key, subject, busy, runner };
};

const idle = (isRunning: Effect.Effect<boolean>) =>
  eventually(Effect.map(isRunning, (running) => !running));

const heldRunner =
  (started: Deferred.Deferred<void>, finish: Deferred.Deferred<void>): Runner<RunInput, never> =>
  (run, emit) =>
    Effect.gen(function* () {
      yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });
      yield* emit({ type: "text", text: "working" });
      yield* Deferred.succeed(started, undefined);
      yield* Deferred.await(finish);
      yield* emit({ type: "done", reply: "ok" });
    });

/** A run that fails as an agent turning it down does, for the first request only. */
const failsFirst: Runner<RunInput, never> = (run, emit) =>
  Effect.andThen(
    emit({ type: "start", subject: run.feedbackId, agent: "codex" }),
    run.feedbackId === "f1"
      ? emit({ type: "error", error: "Not logged in", signedOut: true })
      : emit({ type: "done", reply: "ok" }),
  );

describe("run registry", () => {
  const input = { itemId: "item", feedbackId: "f1", agent: "claude" } as const;

  it.effect("logs a failed run with its agent and error, and nothing for one that finished", () =>
    Effect.gen(function* () {
      const logged = yield* warnings;

      yield* Effect.gen(function* () {
        const registry = yield* makeRunRegistry(itemRuns(failsFirst));

        yield* registry.start(input);
        yield* idle(registry.isRunning("item"));
        yield* registry.start({ ...input, feedbackId: "f2" });
        yield* idle(registry.isRunning("item"));
      }).pipe(Effect.provide(logged.layer));

      expect(yield* logged.lines).toEqual(["codex run failed: Not logged in"]);
    }),
  );

  it.effect("replays a run to late subscribers and allows one run per item", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const registry = yield* makeRunRegistry(itemRuns(heldRunner(started, finish)));

      yield* registry.start(input);
      const conflict = yield* Effect.flip(registry.start({ ...input, feedbackId: "f2" }));
      yield* Deferred.await(started);

      const subscription = yield* registry.subscribe("item");

      const collecting = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(subscription.events, 3)),
      );

      yield* Deferred.succeed(finish, undefined);
      const events = yield* Fiber.join(collecting);
      yield* idle(registry.isRunning("item"));

      const expected: RunEvent[] = [
        { type: "start", subject: "f1", agent: "claude" },
        { type: "text", text: "working" },
        { type: "done", reply: "ok" },
      ];

      expect(conflict).toBeInstanceOf(Conflict);
      expect(Option.getOrUndefined(subscription.subject)).toBe("f1");
      expect(events).toEqual(expected);
    }),
  );

  it.effect("stop interrupts the run and reports it", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();
      const registry = yield* makeRunRegistry(itemRuns(heldRunner(started, finish)));

      yield* registry.start(input);
      yield* Deferred.await(started);

      const subscription = yield* registry.subscribe("item");

      const collecting = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(subscription.events, 3)),
      );

      const stopped = yield* registry.stop("item");
      const events = yield* Fiber.join(collecting);
      const running = yield* registry.isRunning("item");
      const again = yield* registry.stop("item");

      expect(stopped).toBe(true);
      expect(events.map((event) => event.type)).toEqual(["start", "text", "stopped"]);
      expect(running).toBe(false);
      expect(again).toBe(false);
    }),
  );

  it.effect("a run frees its item once it reports its end, and its late events are dropped", () =>
    Effect.gen(function* () {
      const ended = yield* Deferred.make<void>();
      const linger = yield* Deferred.make<void>();
      const lateSent = yield* Deferred.make<void>();

      const registry = yield* makeRunRegistry(
        itemRuns((run, emit) =>
          Effect.gen(function* () {
            yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });
            yield* emit({ type: "done", reply: run.feedbackId });

            if (run.feedbackId !== "f1") return;

            yield* Deferred.succeed(ended, undefined);
            yield* Deferred.await(linger);
            yield* emit({ type: "text", text: "late" });
            yield* Deferred.succeed(lateSent, undefined);
          }),
        ),
      );

      const subscription = yield* registry.subscribe("item");

      const collecting = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(subscription.events, 6)),
      );

      yield* registry.start(input);
      yield* Deferred.await(ended);
      const running = yield* registry.isRunning("item");
      const stopped = yield* registry.stop("item");
      yield* registry.start({ ...input, feedbackId: "f2" });
      yield* Deferred.succeed(linger, undefined);
      yield* Deferred.await(lateSent);
      yield* idle(registry.isRunning("item"));
      yield* registry.start({ ...input, feedbackId: "f3" });
      const events = yield* Fiber.join(collecting);

      expect(running).toBe(false);
      expect(stopped).toBe(false);
      expect(events.map((event) => [event.type, "subject" in event ? event.subject : ""])).toEqual([
        ["start", "f1"],
        ["done", ""],
        ["start", "f2"],
        ["done", ""],
        ["start", "f3"],
        ["done", ""],
      ]);
    }),
  );

  it.effect("a stop that lands as the run finishes adds nothing after its end", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const finish = yield* Deferred.make<void>();

      const registry = yield* makeRunRegistry(
        itemRuns((run, emit, ask) =>
          Effect.uninterruptible(heldRunner(started, finish)(run, emit, ask)),
        ),
      );

      const subscription = yield* registry.subscribe("item");

      const collecting = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(subscription.events, 4)),
      );

      yield* registry.start(input);
      yield* Deferred.await(started);
      const stopping = yield* Effect.forkChild(registry.stop("item"));
      yield* TestClock.adjust("20 millis");
      yield* Deferred.succeed(finish, undefined);
      yield* Fiber.join(stopping);
      yield* registry.start({ ...input, feedbackId: "f2" });

      const events = yield* Fiber.join(collecting);

      expect(events.map((event) => event.type)).toEqual(["start", "text", "done", "start"]);
    }),
  );

  it.effect("a crashing runner becomes an error event and frees the item", () =>
    Effect.gen(function* () {
      const registry = yield* makeRunRegistry(
        itemRuns(() => Effect.die(new Error("disk on fire"))),
      );

      const subscription = yield* registry.subscribe("item");

      const collecting = yield* Effect.forkChild(
        Stream.runCollect(Stream.take(subscription.events, 1)),
      );

      yield* registry.start(input);
      const events = yield* Fiber.join(collecting);
      yield* idle(registry.isRunning("item"));
      yield* registry.start(input);

      expect(events.map((event) => event.type)).toEqual(["error"]);
      expect(JSON.stringify(events[0])).toContain("disk on fire");
    }),
  );
});
