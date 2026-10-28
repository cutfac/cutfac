// @effect-diagnostics strictEffectProvide:off
import { describe, expect } from "bun:test";
import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Ref } from "effect";

import { Workspace, type WorkspaceService } from "../src/core/workspace.ts";
import { initWorkspace } from "../src/core/workspaceRoot.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

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

  const openName = Effect.map(Workspace, (ws) => ws.config.name).pipe(
    Effect.provide(Workspace.layer(root)),
  );

  const inWorkspace = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.andThen(
      write("cutfac.yaml", "name: Busy\n"),
      Effect.provide(effect, Workspace.layer(root)),
    );

  return { root, write, exists, read, openName, inWorkspace };
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

describe("writing a file", () => {
  const SIZE = 2_000_000;
  const FILE = "state.txt";
  const first = "a".repeat(SIZE);
  const second = "b".repeat(SIZE);

  const rewriting = <E>(
    write: (ws: WorkspaceService, text: string) => Effect.Effect<void, E>,
    read: (ws: WorkspaceService) => Effect.Effect<string, E>,
  ) =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const seen = yield* Ref.make<ReadonlyArray<string>>([]);

      const note = (what: string) => Ref.update(seen, (all) => [...all, what]);

      yield* write(ws, first);

      const reader = Effect.gen(function* () {
        const text = yield* read(ws);

        if (text !== first && text !== second) yield* note(`read ${text.length} characters`);

        const names = (yield* ws.list("")).map((entry) => entry.name);

        if (names.some((name) => name !== FILE && name !== "cutfac.yaml"))
          yield* note(`listed ${names.join(", ")}`);
      }).pipe(Effect.forever);

      const writer = Effect.forEach(
        Array.from({ length: 150 }, (_, n) => (n % 2 === 0 ? second : first)),
        (text) => write(ws, text),
        { discard: true },
      );

      yield* Effect.raceFirst(
        writer,
        Effect.all(
          Array.from({ length: 4 }, () => reader),
          { concurrency: "unbounded" },
        ),
      );

      expect((yield* Ref.get(seen)).slice(0, 3)).toEqual([]);
    });

  it.live("a reader never sees a text file empty or half written", () =>
    Effect.gen(function* () {
      const { inWorkspace } = yield* folder;

      yield* inWorkspace(
        rewriting(
          (ws, text) => ws.writeText(FILE, text),
          (ws) => ws.readText(FILE),
        ),
      );
    }),
  );

  it.live("a reader never sees a binary file empty or half written", () =>
    Effect.gen(function* () {
      const { inWorkspace } = yield* folder;

      yield* inWorkspace(
        rewriting(
          (ws, text) => ws.writeBytes(FILE, new TextEncoder().encode(text)),
          (ws) => ws.readText(FILE),
        ),
      );
    }),
  );

  it.live("a write that fails leaves nothing behind", () =>
    Effect.gen(function* () {
      const { root, inWorkspace } = yield* folder;
      const fs = yield* FileSystem.FileSystem;

      yield* inWorkspace(
        Effect.gen(function* () {
          const ws = yield* Workspace;

          yield* ws.mkdir("taken");
          yield* Effect.flip(ws.writeText("taken", "text"));
        }),
      );

      expect((yield* fs.readDirectory(root)).toSorted()).toEqual(["cutfac.yaml", "taken"]);
    }),
  );
});
