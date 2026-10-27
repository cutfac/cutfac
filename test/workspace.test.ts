// Each test opens a workspace it made by hand, so it provides the layer itself.
// @effect-diagnostics strictEffectProvide:off
import { expect } from "bun:test";
import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem } from "effect";

import { Workspace, initWorkspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

/** A folder that is no workspace yet, which opening may rename the files of. */
const folder = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const root = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-workspace-" });

  const write = (rel: string, text: string) =>
    Effect.andThen(
      fs.makeDirectory(dirname(join(root, rel)), { recursive: true }),
      fs.writeFileString(join(root, rel), text),
    );

  const exists = (rel: string) => fs.exists(join(root, rel));
  const read = (rel: string) => fs.readFileString(join(root, rel));

  /** Open the workspace at `root` and return its name. */
  const openName = Effect.map(Workspace, (ws) => ws.config.name).pipe(
    Effect.provide(Workspace.layer(root)),
  );

  return { root, write, exists, read, openName };
});

it.live("opening a workspace from before the rename to Cutfac renames its files", () =>
  Effect.gen(function* () {
    const { write, exists, read, openName } = yield* folder;

    yield* write("factory.yaml", "name: Old\n");
    yield* write(".factory/imports/0badf00d.yaml", "link: https://example.com\n");
    yield* write(".agents/skills/content-factory/SKILL.md", "agents copy");
    yield* write(".claude/skills/content-factory/SKILL.md", "claude copy");

    expect(yield* openName).toBe("Old");

    expect(yield* exists("factory.yaml")).toBe(false);
    expect(yield* read("cutfac.yaml")).toBe("name: Old\n");
    expect(yield* exists(".cutfac/imports/0badf00d.yaml")).toBe(true);
    expect(yield* read(".agents/skills/cutfac/SKILL.md")).toBe("agents copy");
    expect(yield* read(".claude/skills/cutfac/SKILL.md")).toBe("claude copy");
  }),
);

it.live("a file that already has its new name is never replaced", () =>
  Effect.gen(function* () {
    const { write, read, openName } = yield* folder;

    yield* write("factory.yaml", "name: Old\n");
    yield* write("cutfac.yaml", "name: New\n");

    expect(yield* openName).toBe("New");
    expect(yield* read("factory.yaml")).toBe("name: Old\n");
  }),
);

it.live("init leaves a workspace from before the rename as it is", () =>
  Effect.gen(function* () {
    const { root, write, exists } = yield* folder;

    yield* write("factory.yaml", "name: Old\n");

    const created = yield* initWorkspace(root, { name: "New" });

    expect(created).toBe(false);
    expect(yield* exists("cutfac.yaml")).toBe(false);
  }),
);
