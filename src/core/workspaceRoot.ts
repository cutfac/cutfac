import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { stringify } from "yaml";

import { WorkspaceError } from "./errors.ts";
import { WorkspaceConfig } from "./schema.ts";

export const CONFIG_FILE = "cutfac.yaml";

/** Where Cutfac keeps a workspace's own records that are not content, such as template imports. */
export const STATE_DIR = ".cutfac";

const LEGACY_CONFIG_FILE = "factory.yaml";

/**
 * What a workspace made before Content Factory was renamed to Cutfac calls these files, and their
 * names now. Opening the workspace renames them, unless something already has the new name.
 */
const RENAMED: ReadonlyArray<readonly [before: string, now: string]> = [
  [LEGACY_CONFIG_FILE, CONFIG_FILE],
  [".factory", STATE_DIR],
  [".agents/skills/content-factory", ".agents/skills/cutfac"],
  [".claude/skills/content-factory", ".claude/skills/cutfac"],
];

export const fileFailure = (action: string, target: string) => (error: PlatformError) =>
  new WorkspaceError({ message: `Could not ${action} ${target} (${error.reason._tag})` });

const pathExists = Effect.fnUntraced(function* (full: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.exists(full).pipe(Effect.orElseSucceed(() => false));
});

/** Whether `dir` holds a config file, current or from before the rename. */
export const isWorkspaceRoot = Effect.fnUntraced(function* (dir: string) {
  const path = yield* Path.Path;

  const found = yield* Effect.forEach([CONFIG_FILE, LEGACY_CONFIG_FILE], (name) =>
    pathExists(path.join(dir, name)),
  );

  return found.some(Boolean);
});

/** Find the folder holding the config file, starting at `start` and walking up. */
export const findRoot = Effect.fnUntraced(function* (start: string) {
  const path = yield* Path.Path;
  let dir = path.resolve(start);

  for (;;) {
    if (yield* isWorkspaceRoot(dir)) return Option.some(dir);
    const parent = path.dirname(dir);

    if (parent === dir) return Option.none<string>();
    dir = parent;
  }
});

/**
 * Write cutfac.yaml into `dir` unless it is a workspace already. Returns whether it wrote one. This
 * and the app's own records in `appData.ts` are the only writes outside an opened workspace: this
 * one is what makes `dir` a workspace.
 */
export const initWorkspace = Effect.fn("Workspace.init")(function* (
  dir: string,
  config: typeof WorkspaceConfig.Encoded,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(dir, CONFIG_FILE);

  const failed = (error: PlatformError | Schema.SchemaError) =>
    new WorkspaceError({ message: `Could not create ${file}: ${error.message}` });

  if (yield* isWorkspaceRoot(dir)) return false;

  const encoded = yield* Schema.decodeEffect(WorkspaceConfig)(config).pipe(
    Effect.flatMap(Schema.encodeEffect(WorkspaceConfig)),
    Effect.mapError(failed),
  );

  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(failed));
  yield* fs
    .writeFileString(file, stringify(encoded, { lineWidth: 100 }))
    .pipe(Effect.mapError(failed));

  return true;
});

/** Give a file from before the rename its current name, unless something already has it. */
const moveRenamed = Effect.fnUntraced(function* (root: string, before: string, now: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const from = path.join(root, before);
  const to = path.join(root, now);

  if (!(yield* pathExists(from)) || (yield* pathExists(to))) return;

  // Another process opening the same workspace may have moved it first.
  yield* fs
    .rename(from, to)
    .pipe(
      Effect.catch((error) =>
        Effect.flatMap(pathExists(to), (moved) =>
          moved ? Effect.void : Effect.fail(fileFailure("rename", `${before} to ${now}`)(error)),
        ),
      ),
    );
});

/** Give the files of a workspace made before the rename their current names. */
export const renameLegacyFiles = (root: string) =>
  Effect.forEach(RENAMED, ([before, now]) => moveRenamed(root, before, now), { discard: true });
