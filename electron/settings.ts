import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { app } from "electron";

interface Settings {
  workspace: string;
}

function settingsFile(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

/** The last workspace the user opened, or undefined if none is saved or its folder is gone. */
export async function loadWorkspace(): Promise<string | undefined> {
  try {
    const settings: Partial<Settings> = JSON.parse(await readFile(settingsFile(), "utf8"));
    const workspace = settings.workspace;

    // A malformed value makes stat throw, which lands in the catch like a missing folder.
    return workspace && (await stat(workspace)).isDirectory() ? workspace : undefined;
  } catch {
    return undefined;
  }
}

export async function saveWorkspace(workspace: string): Promise<void> {
  const settings = { workspace } satisfies Settings;

  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
}
