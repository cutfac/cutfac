// Each test opens a workspace it made by hand, so it provides the layers itself.
// @effect-diagnostics strictEffectProvide:off
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, Layer } from "effect";

import { Workspace, initWorkspace } from "../src/core/workspace.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "cutfac-workspace-"));
});

afterEach(() => rm(root, { recursive: true, force: true }));

const write = async (rel: string, text: string) => {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
};

const exists = (rel: string) => Bun.file(join(root, rel)).exists();

/** Open the workspace at `root` and return its name. */
const openName = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const ws = yield* Workspace;

      return ws.config.name;
    }).pipe(Effect.provide(Workspace.layer(root).pipe(Layer.provide(BunServices.layer)))),
  );

test("opening a workspace from before the rename to Cutfac renames its files", async () => {
  await write("factory.yaml", "name: Old\n");
  await write(".factory/imports/0badf00d.yaml", "link: https://example.com\n");
  await write(".agents/skills/content-factory/SKILL.md", "agents copy");
  await write(".claude/skills/content-factory/SKILL.md", "claude copy");

  expect(await openName()).toBe("Old");

  expect(await exists("factory.yaml")).toBe(false);
  expect(await readFile(join(root, "cutfac.yaml"), "utf8")).toBe("name: Old\n");
  expect(await exists(".cutfac/imports/0badf00d.yaml")).toBe(true);
  expect(await readFile(join(root, ".agents/skills/cutfac/SKILL.md"), "utf8")).toBe("agents copy");
  expect(await readFile(join(root, ".claude/skills/cutfac/SKILL.md"), "utf8")).toBe("claude copy");
});

test("a file that already has its new name is never replaced", async () => {
  await write("factory.yaml", "name: Old\n");
  await write("cutfac.yaml", "name: New\n");

  expect(await openName()).toBe("New");
  expect(await readFile(join(root, "factory.yaml"), "utf8")).toBe("name: Old\n");
});

test("init leaves a workspace from before the rename as it is", async () => {
  await write("factory.yaml", "name: Old\n");

  const created = await Effect.runPromise(
    initWorkspace(root, { name: "New" }).pipe(Effect.provide(BunServices.layer)),
  );

  expect(created).toBe(false);
  expect(await exists("cutfac.yaml")).toBe(false);
});
