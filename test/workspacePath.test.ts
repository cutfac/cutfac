import { describe, expect } from "bun:test";

import { Effect, FileSystem, Option, Path } from "effect";

import { platform } from "../electron/runtime.ts";
import { inWorkspace, workspaceRoot } from "../electron/workspacePath.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(platform);

/** A workspace with a file in it, a link out of it, and a folder beside it; removed after. */
const folders = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-paths-" }));
  const root = path.join(dir, "work");
  const beside = path.join(dir, "work-other");

  yield* fs.makeDirectory(path.join(root, "videos"), { recursive: true });
  yield* fs.makeDirectory(beside);
  yield* fs.writeFileString(path.join(root, "videos", "cut.mp4"), "");
  yield* fs.symlink(beside, path.join(root, "out"));

  return { root, beside, path };
});

/** Why `target` isn't a path in the workspace at `root`, or the path it is. */
const resolve = (root: Option.Option<string>, target: string) =>
  inWorkspace(root, target).pipe(
    Effect.match({ onFailure: (error) => error.message, onSuccess: (file) => file }),
  );

describe("paths in the workspace", () => {
  it.effect("are resolved from the root or as given, links and all", () =>
    Effect.gen(function* () {
      const { root, path } = yield* folders;
      const file = path.join(root, "videos", "cut.mp4");

      expect(yield* inWorkspace(Option.some(root), "videos/cut.mp4")).toBe(file);
      expect(yield* inWorkspace(Option.some(root), file)).toBe(file);
      expect(yield* inWorkspace(Option.some(root), ".")).toBe(root);
    }),
  );

  it.effect("outside the workspace, through a link or beside it, are refused", () =>
    Effect.gen(function* () {
      const { root, beside } = yield* folders;
      const workspace = Option.some(root);

      expect(yield* resolve(workspace, "out")).toBe("Path is outside the workspace");
      expect(yield* resolve(workspace, beside)).toBe("Path is outside the workspace");
      expect(yield* resolve(workspace, "..")).toBe("Path is outside the workspace");
    }),
  );

  it.effect("need an open workspace and a file that is there", () =>
    Effect.gen(function* () {
      const { root } = yield* folders;
      const missing = yield* Effect.flip(inWorkspace(Option.some(root), "gone.mp4"));

      expect(yield* resolve(workspaceRoot(undefined), "x")).toBe("No workspace is open");
      expect(yield* resolve(workspaceRoot(""), "x")).toBe("No workspace is open");
      expect(missing._tag).toBe("PlatformError");
    }),
  );
});
