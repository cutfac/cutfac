import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isSetAside, restore, setAside } from "../electron/settingsAside.ts";

describe("settings set aside", () => {
  let dir: string;
  let file: string;
  let backup: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "cutfac-aside-"));
    file = join(dir, "settings.json");
    backup = join(dir, "settings.dev-backup.json");
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("moves the settings out of the way, and back", async () => {
    await writeFile(file, '{"workspace":"/work"}\n');
    await setAside(file, backup);

    expect(await isSetAside(backup)).toBe(true);
    expect(await Bun.file(file).exists()).toBe(false);
    expect(await restore(file, backup)).toBe(true);
    expect(await readFile(file, "utf8")).toBe('{"workspace":"/work"}\n');
    expect(await isSetAside(backup)).toBe(false);
  });

  test("keeps the first backup when set aside again", async () => {
    await writeFile(file, '{"workspace":"/work"}\n');
    await setAside(file, backup);
    // A pretend user's settings, from going through the first launch.
    await writeFile(file, '{"workspace":"/qa"}\n');
    await setAside(file, backup);

    expect(await Bun.file(file).exists()).toBe(false);
    expect(await restore(file, backup)).toBe(true);
    expect(await readFile(file, "utf8")).toBe('{"workspace":"/work"}\n');
  });

  test("restores no settings as none", async () => {
    await setAside(file, backup);
    await writeFile(file, '{"workspace":"/qa"}\n');

    expect(await restore(file, backup)).toBe(true);
    expect(await readFile(file, "utf8")).toBe("{}\n");
  });

  test("says when there is nothing to restore", async () => {
    await writeFile(file, '{"workspace":"/work"}\n');

    expect(await restore(file, backup)).toBe(false);
    expect(await readFile(file, "utf8")).toBe('{"workspace":"/work"}\n');
  });
});
