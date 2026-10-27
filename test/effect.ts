import { test } from "bun:test";

// Each test runs its effect to completion, so it is the entry point that provides layers.
// @effect-diagnostics strictEffectProvide:off
import { Cause, Effect, Exit, Layer, type Scope } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock, TestConsole } from "effect/testing";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * `fetch` for tests, which refuses any host but this machine and records the attempt, so a test
 * that forgot to replace the HttpClient fails instead of reaching cutfac.com.
 */
const refuseNetwork = (violations: string[]): typeof fetch =>
  Object.assign(
    (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);

      if (LOOPBACK.has(url.hostname)) return fetch(input, init);

      const message = `The test asked ${url.href}; give it an HttpClient of its own`;

      violations.push(message);

      return Promise.reject(new Error(message));
    },
    { preconnect: fetch.preconnect },
  );

/** Runs a test's effect in its own scope with `layer`, failing with its error or a network call. */
const run = <A, E, R, E2>(
  body: () => Effect.Effect<A, E, R | Scope.Scope>,
  layer: Layer.Layer<R, E2>,
) =>
  Effect.gen(function* () {
    const violations: string[] = [];

    const exit = yield* Effect.suspend(body).pipe(
      Effect.scoped,
      Effect.provide(layer),
      Effect.provideService(FetchHttpClient.Fetch, refuseNetwork(violations)),
      Effect.exit,
    );

    if (Exit.isFailure(exit))
      for (const error of Cause.prettyErrors(exit.cause)) yield* Effect.logError(error);

    if (violations.length > 0) return yield* Effect.die(new Error(violations.join("\n")));

    return yield* exit;
  }).pipe(Effect.runPromise);

const make = <R, E>(testLayer: Layer.Layer<R, E>, liveLayer: Layer.Layer<R, E>) => ({
  /** A test on a test clock, which only moves when the test moves it with `TestClock`. */
  effect: <A, E2>(name: string, body: () => Effect.Effect<A, E2, R | Scope.Scope>) =>
    test(name, () => run(body, testLayer)),
  /**
   * A test on the real clock, for code that waits on the file system or other processes; `timeout`
   * in milliseconds, for one that waits longer than bun's default allows.
   */
  live: <A, E2>(
    name: string,
    body: () => Effect.Effect<A, E2, R | Scope.Scope>,
    timeout?: number,
  ) => test(name, () => run(body, liveLayer), timeout),
});

const testEnv = Layer.mergeAll(TestConsole.layer, TestClock.layer());

/** bun:test for Effect bodies, as @effect/vitest's `it` is for Vitest. */
export const it = make(testEnv, TestConsole.layer);

/** `it`, with `layer` built anew for each test, on the test clock or the real one. */
export const testEffect = <R, E>(layer: Layer.Layer<R, E>) =>
  make(Layer.provideMerge(layer, testEnv), Layer.provideMerge(layer, TestConsole.layer));
