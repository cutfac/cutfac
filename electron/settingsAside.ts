import { access, rename, rm, writeFile } from "node:fs/promises";

const exists = (file: string) =>
  access(file).then(
    () => true,
    () => false,
  );

/**
 * Moves the settings in `file` to `backup`, so the app starts as it would on a new Mac. A backup
 * already there is kept: it holds the settings from before the first time, not a pretend user's.
 * With no settings yet, the backup is an empty set, so restoring them means none again.
 */
export async function setAside(file: string, backup: string): Promise<void> {
  if (await exists(backup)) {
    await rm(file, { force: true });

    return;
  }

  if (await exists(file)) await rename(file, backup);
  else await writeFile(backup, "{}\n");
}

/** Puts the settings set aside back over `file`. Resolves false if none were. */
export async function restore(file: string, backup: string): Promise<boolean> {
  if (!(await exists(backup))) return false;

  await rename(backup, file);

  return true;
}

export const isSetAside = exists;
