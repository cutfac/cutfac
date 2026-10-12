import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each helper runs a test's effect to completion, so it is the entry point that provides layers.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { Workspace } from "../src/core/workspace.ts";

/** What a core effect may need in tests: the workspace and the Bun platform services. */
export type TestServices = Workspace | BunServices.BunServices;

export interface TestWorkspace {
  readonly root: string;
  /** Run an effect against this workspace, rejecting with the effect's error. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, TestServices>) => Promise<A>;
  /** Run an effect that also needs `extra`, such as a fake HTTP client. */
  readonly runWith: <A, E, R>(
    extra: Layer.Layer<R>,
    effect: Effect.Effect<A, E, R | TestServices>,
  ) => Promise<A>;
  /** Run an effect that is expected to fail, resolving with its error. */
  readonly fail: <A, E>(effect: Effect.Effect<A, E, TestServices>) => Promise<E>;
  readonly layer: Layer.Layer<TestServices>;
  readonly remove: () => Promise<void>;
}

/** A fresh folder with a factory.yaml, removed by `remove`. */
export async function makeWorkspace(name = "test"): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "factory-test-"));
  await writeFile(join(root, "factory.yaml"), `name: ${name}\n`);

  const layer = Workspace.layer(root).pipe(Layer.provideMerge(BunServices.layer), Layer.orDie);

  return {
    root,
    layer,
    run: (effect) => Effect.runPromise(Effect.provide(effect, layer)),
    runWith: (extra, effect) =>
      Effect.runPromise(Effect.provide(effect, Layer.merge(layer, extra))),
    fail: (effect) => Effect.runPromise(Effect.provide(Effect.flip(effect), layer)),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}
