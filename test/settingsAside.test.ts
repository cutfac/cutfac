import { describe, expect } from "bun:test";

import { Effect, FileSystem, Path } from "effect";

import { platform } from "../electron/runtime.ts";
import { isSetAside, restore, setAside } from "../electron/settingsAside.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(platform);

/** The settings file and its backup, in a folder removed after the test. */
const files = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-aside-" });

  return {
    file: path.join(dir, "settings.json"),
    backup: path.join(dir, "settings.dev-backup.json"),
  };
});

describe("settings set aside", () => {
  it.effect("moves the settings out of the way, and back", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, backup } = yield* files;

      yield* fs.writeFileString(file, '{"workspace":"/work"}\n');
      yield* setAside(file, backup);

      expect(yield* isSetAside(backup)).toBe(true);
      expect(yield* fs.exists(file)).toBe(false);
      expect(yield* restore(file, backup)).toBe(true);
      expect(yield* fs.readFileString(file)).toBe('{"workspace":"/work"}\n');
      expect(yield* isSetAside(backup)).toBe(false);
    }),
  );

  it.effect("keeps the first backup when set aside again", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, backup } = yield* files;

      yield* fs.writeFileString(file, '{"workspace":"/work"}\n');
      yield* setAside(file, backup);
      // A pretend user's settings, from going through the first launch.
      yield* fs.writeFileString(file, '{"workspace":"/qa"}\n');
      yield* setAside(file, backup);

      expect(yield* fs.exists(file)).toBe(false);
      expect(yield* restore(file, backup)).toBe(true);
      expect(yield* fs.readFileString(file)).toBe('{"workspace":"/work"}\n');
    }),
  );

  it.effect("restores no settings as none", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, backup } = yield* files;

      yield* setAside(file, backup);
      yield* fs.writeFileString(file, '{"workspace":"/qa"}\n');

      expect(yield* restore(file, backup)).toBe(true);
      expect(yield* fs.readFileString(file)).toBe("{}\n");
    }),
  );

  it.effect("says when there is nothing to restore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { file, backup } = yield* files;

      yield* fs.writeFileString(file, '{"workspace":"/work"}\n');

      expect(yield* restore(file, backup)).toBe(false);
      expect(yield* fs.readFileString(file)).toBe('{"workspace":"/work"}\n');
    }),
  );
});
