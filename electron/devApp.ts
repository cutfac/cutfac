/**
 * The Electron binary `desktop:dev` runs on macOS, "Cutfac Dev": a copy of the stock Electron.app
 * under its own bundle id. Every app run on stock Electron is `com.github.Electron`, so macOS
 * permissions and tools that pick an app by bundle id (an agent's computer use) cannot tell them
 * apart, and a grant to one is a grant to all. The copy is cached in node_modules and rebuilt when
 * the installed Electron changes.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";

export const DEV_APP = { name: "Cutfac Dev", bundleId: "com.cutfac.dev" };

const decodePackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.NonEmptyString }));

/** The Cutfac Dev executable, built on first use. macOS only. */
export async function devElectron(root: string): Promise<string> {
  const electron = path.join(root, "node_modules", "electron");
  const cache = path.join(root, "node_modules", ".cache", "cutfac-dev");
  const bundle = path.join(cache, `${DEV_APP.name}.app`);
  const executable = path.join(bundle, "Contents", "MacOS", "Electron");
  const stampFile = path.join(cache, "stamp.json");

  const { version } = decodePackage(await Bun.file(path.join(electron, "package.json")).json());

  const stamp = JSON.stringify({ electron: version, ...DEV_APP });

  if ((await readFile(stampFile, "utf8").catch(() => undefined)) === stamp) return executable;

  await rm(cache, { recursive: true, force: true });
  await mkdir(cache, { recursive: true });
  // -c clones on APFS, so the copy is instant and takes no space; -R keeps the framework symlinks.
  await run(["cp", "-Rc", path.join(electron, "dist", "Electron.app"), bundle]);

  const plist = path.join(bundle, "Contents", "Info.plist");

  for (const [key, value] of [
    ["CFBundleIdentifier", DEV_APP.bundleId],
    ["CFBundleName", DEV_APP.name],
    ["CFBundleDisplayName", DEV_APP.name],
  ] as const) {
    await run(["/usr/libexec/PlistBuddy", "-c", `Set :${key} "${value}"`, plist]);
  }

  // The edit breaks Electron's signature, and Apple silicon will not run an unsigned app.
  await run(["codesign", "--force", "--deep", "--sign", "-", bundle]);
  // Last, so a copy cut short is rebuilt on the next run.
  await writeFile(stampFile, stamp);

  return executable;
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: "ignore", stderr: "pipe" });
  const stderr = await new Response(child.stderr).text();

  if ((await child.exited) !== 0) {
    throw new Error(`\`${command.join(" ")}\` failed: ${stderr.trim()}`);
  }
}
