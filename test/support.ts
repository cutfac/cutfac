import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each helper runs a test's effect to completion, so it is the entry point that provides layers.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, Layer, Option } from "effect";

import { which } from "../src/core/process.ts";
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

/** A fresh folder with a cutfac.yaml, removed by `remove`. */
export async function makeWorkspace(name = "test"): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "cutfac-test-"));
  await writeFile(join(root, "cutfac.yaml"), `name: ${name}\n`);

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

export interface FakeAgents {
  readonly dir: string;
  /** Where a fake can record what it was given: `calls` in `dir`. */
  readonly calls: string;
  /** A PATH of only the fakes, for wherever an agent CLI is looked up. */
  readonly layer: Layer.Layer<never>;
  /** Put an executable `name` on that PATH that runs `script` with sh. */
  readonly bin: (name: string, script: string) => Promise<string>;
  readonly remove: () => Promise<void>;
}

/**
 * A folder of fake agent CLIs and a PATH of only them, so a real `claude` or `codex` on this
 * machine is never found or run. Throws if one still is.
 */
export async function makeFakeAgents(): Promise<FakeAgents> {
  const dir = await mkdtemp(join(tmpdir(), "cutfac-fake-agent-"));
  const calls = join(dir, "calls");
  await mkdir(join(dir, "bin"));
  await mkdir(calls);

  const layer = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PATH: join(dir, "bin") } }));
  const remove = () => rm(dir, { recursive: true, force: true });
  const found = Effect.forEach(["claude", "codex"], which).pipe(Effect.provide(layer));

  if ((await Effect.runPromise(found)).some(Option.isSome)) {
    await remove();
    throw new Error("A real agent CLI is still on PATH; the tests must only run fakes");
  }

  const bin = async (name: string, script: string) => {
    const path = join(dir, "bin", name);
    await writeFile(path, `#!/bin/sh\nPATH=/bin:/usr/bin\n${script}`);
    await chmod(path, 0o755);

    return path;
  };

  return { dir, calls, layer, bin, remove };
}
