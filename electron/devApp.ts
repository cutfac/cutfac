/**
 * The Electron binary `desktop:dev` runs on macOS, "Cutfac Dev": a copy of the stock Electron.app
 * under its own bundle id. Every app run on stock Electron is `com.github.Electron`, so macOS
 * permissions and tools that pick an app by bundle id (an agent's computer use) cannot tell them
 * apart, and a grant to one is a grant to all. It wears the Cutfac icon with a DEV band, so the Dock
 * tells it from the released app. The copy is cached in node_modules and rebuilt when the installed
 * Electron or the icon changes.
 */
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";

export const DEV_APP = { name: "Cutfac Dev", bundleId: "com.cutfac.dev" };

const decodePackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.NonEmptyString }));

/** An object schema that keeps the keys it does not name, so a rewrite drops nothing. */
const openStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);

// Only what the band needs from an Icon Composer document; groups run front to back.
const IconManifest = openStruct({
  groups: Schema.NonEmptyArray(openStruct({ layers: Schema.Array(Schema.Unknown) })),
});

type IconManifest = typeof IconManifest.Type;

export const decodeIconManifest = Schema.decodeUnknownSync(IconManifest);

const BAND = "dev.svg";

/** The Icon Composer manifest with the DEV band as the front layer, out of the glass. */
export function devIconManifest({ groups: [front, ...back], ...rest }: IconManifest): IconManifest {
  const band = { "image-name": BAND, name: "dev", glass: false };

  return { ...rest, groups: [{ ...front, layers: [band, ...front.layers] }, ...back] };
}

/** The Cutfac Dev executable, built on first use. macOS only. */
export async function devElectron(root: string, log: (message: string) => void): Promise<string> {
  const electron = path.join(root, "node_modules", "electron");
  const cache = path.join(root, "node_modules", ".cache", "cutfac-dev");
  const bundle = path.join(cache, `${DEV_APP.name}.app`);
  const executable = path.join(bundle, "Contents", "MacOS", "Electron");
  const stampFile = path.join(cache, "stamp.json");

  const icon = {
    source: path.join(root, "build", "icon.icon"),
    band: path.join(root, "build", "icon-dev-badge.svg"),
  };

  const { version } = decodePackage(await Bun.file(path.join(electron, "package.json")).json());

  const stamp = JSON.stringify({ electron: version, ...DEV_APP, icon: await hashIcon(icon) });

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

  let iconSet = false;

  // Electron's own icon is no reason to stop: the app runs the same without the band.
  try {
    await setIcon(icon, path.join(cache, "icon"), bundle);
    iconSet = true;
  } catch (error) {
    log(
      `Could not give ${DEV_APP.name} its icon (it needs Xcode 26), keeping Electron's: ${String(error)}`,
    );
  }

  // The edits break Electron's signature, and Apple silicon will not run an unsigned app.
  await run(["codesign", "--force", "--deep", "--sign", "-", bundle]);

  // Last, so a copy cut short is rebuilt on the next run, and a missing icon is tried again.
  if (iconSet) await writeFile(stampFile, stamp);

  return executable;
}

type IconSources = { source: string; band: string };

/** A digest of every file that goes into the icon, so a change to any of them rebuilds it. */
async function hashIcon({ source, band }: IconSources): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");

  const files = (await readdir(source, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name))
    .toSorted();

  for (const file of [...files, band]) {
    hasher.update(path.relative(source, file));
    hasher.update(await readFile(file));
  }

  return hasher.digest("hex");
}

/** Compiles the Cutfac icon with the DEV band into `bundle`, as the Liquid Glass icon and the icns. */
async function setIcon({ source, band }: IconSources, work: string, bundle: string): Promise<void> {
  const document = path.join(work, "Icon.icon");
  const out = path.join(work, "out");
  const manifest = path.join(document, "icon.json");

  await mkdir(out, { recursive: true });
  await run(["cp", "-R", source, document]);
  await copyFile(band, path.join(document, "Assets", BAND));
  await writeFile(
    manifest,
    JSON.stringify(devIconManifest(decodeIconManifest(await Bun.file(manifest).json()))),
  );
  // Writes Assets.car, which macOS 26 draws by CFBundleIconName, and Icon.icns for older systems.
  await run([
    "xcrun",
    "actool",
    document,
    "--compile",
    out,
    "--output-format",
    "human-readable-text",
    "--output-partial-info-plist",
    path.join(out, "info.plist"),
    "--app-icon",
    "Icon",
    "--include-all-app-icons",
    "--target-device",
    "mac",
    "--minimum-deployment-target",
    "26.0",
    "--platform",
    "macosx",
  ]);

  const resources = path.join(bundle, "Contents", "Resources");

  await copyFile(path.join(out, "Assets.car"), path.join(resources, "Assets.car"));
  // Info.plist names electron.icns as the icon file, so the icns takes its place.
  await copyFile(path.join(out, "Icon.icns"), path.join(resources, "electron.icns"));
  await run([
    "/usr/libexec/PlistBuddy",
    "-c",
    "Add :CFBundleIconName string Icon",
    path.join(bundle, "Contents", "Info.plist"),
  ]);
}

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { stdout: "pipe", stderr: "pipe" });

  // actool reports its errors on stdout.
  const [stdout, stderr] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  if ((await child.exited) !== 0) {
    throw new Error(`\`${command.join(" ")}\` failed: ${`${stdout}\n${stderr}`.trim()}`);
  }
}
