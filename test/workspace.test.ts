// @effect-diagnostics strictEffectProvide:off
import { describe, expect } from "bun:test";
import { dirname, join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, FileSystem, Layer } from "effect";

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
  const FILE = "state.txt";

  const seenAroundWrite = <E>(
    write: (ws: WorkspaceService, text: string) => Effect.Effect<void, E>,
  ) =>
    Effect.gen(function* () {
      const { root, write: put } = yield* folder;
      const fs = yield* FileSystem.FileSystem;
      const halfway = yield* Deferred.make<void>();
      const seen = yield* Deferred.make<void>();

      const slowDisk = FileSystem.make({
        ...fs,
        writeFile: (path, data, options) =>
          fs
            .writeFile(path, data.subarray(0, data.length / 2), options)
            .pipe(
              Effect.andThen(Deferred.succeed(halfway, undefined)),
              Effect.andThen(Deferred.await(seen)),
              Effect.andThen(fs.writeFile(path, data, options)),
            ),
      });

      yield* put("cutfac.yaml", "name: Busy\n");
      yield* put(FILE, "old text");

      return yield* Effect.gen(function* () {
        const ws = yield* Workspace;

        const look = Effect.all({
          text: ws.readText(FILE),
          names: Effect.map(ws.list(""), (entries) => entries.map((entry) => entry.name)),
        });

        const [, during] = yield* Effect.all(
          [
            write(ws, "new text"),
            Deferred.await(halfway).pipe(
              Effect.andThen(look),
              Effect.tap(() => Deferred.succeed(seen, undefined)),
            ),
          ],
          { concurrency: "unbounded" },
        );

        return { during, after: yield* look };
      }).pipe(
        Effect.provide(
          Workspace.layer(root).pipe(Layer.provide(Layer.succeed(FileSystem.FileSystem, slowDisk))),
        ),
      );
    });

  const wholeEachTime = {
    during: { text: "old text", names: ["cutfac.yaml", FILE] },
    after: { text: "new text", names: ["cutfac.yaml", FILE] },
  };

  it.live("a reader sees a text file as it was until the write is done, never half written", () =>
    Effect.gen(function* () {
      expect(yield* seenAroundWrite((ws, text) => ws.writeText(FILE, text))).toEqual(wholeEachTime);
    }),
  );

  it.live("a reader sees a binary file as it was until the write is done, never half written", () =>
    Effect.gen(function* () {
      expect(
        yield* seenAroundWrite((ws, text) => ws.writeBytes(FILE, new TextEncoder().encode(text))),
      ).toEqual(wholeEachTime);
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
