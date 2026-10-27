import { Effect, FileSystem } from "effect";

/** Whether `file` is there; one that can't be checked counts as missing. */
const exists = (file: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(file)).pipe(
    Effect.orElseSucceed(() => false),
  );

/**
 * Moves the settings in `file` to `backup`, so the app starts as it would on a new Mac. A backup
 * already there is kept: it holds the settings from before the first time, not a pretend user's.
 * With no settings yet, the backup is an empty set, so restoring them means none again.
 */
export const setAside = Effect.fn("settings.setAside")(function* (file: string, backup: string) {
  const fs = yield* FileSystem.FileSystem;

  if (yield* exists(backup)) return yield* fs.remove(file, { force: true });

  if (yield* exists(file)) yield* fs.rename(file, backup);
  else yield* fs.writeFileString(backup, "{}\n");
});

/** Puts the settings set aside back over `file`. Succeeds with false if none were. */
export const restore = Effect.fn("settings.restore")(function* (file: string, backup: string) {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* exists(backup))) return false;

  yield* fs.rename(backup, file);

  return true;
});

export const isSetAside = exists;
