/**
 * The Electron binary `desktop:dev` runs on macOS, "Cutfac Dev": a copy of the stock Electron.app
 * under its own bundle id. Every app run on stock Electron is `com.github.Electron`, so macOS
 * permissions and tools that pick an app by bundle id (an agent's computer use) cannot tell them
 * apart, and a grant to one is a grant to all. It wears the Cutfac icon with a DEV band, so the Dock
 * tells it from the released app. The copy is cached in node_modules and rebuilt when the installed
 * Electron or the icon changes.
 */
import { Console, Crypto, Effect, FileSystem, Option, Path, Schema } from "effect";
import { Hex } from "effect/encoding";

import { run } from "../src/core/process.ts";

export const DEV_APP = { name: "Cutfac Dev", bundleId: "com.cutfac.app.dev" };

export class DevAppFailed extends Schema.TaggedError<DevAppFailed>()("DevAppFailed", {
  message: Schema.String,
}) {}

const decodePackage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString })),
);

/** An object schema that keeps the keys it does not name, so a rewrite drops nothing. */
const openStruct = <const Fields extends Schema.Struct.Fields>(fields: Fields) =>
  Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(Schema.String, Schema.Unknown)]);

// Only what the band needs from an Icon Composer document; groups run front to back.
const IconManifest = openStruct({
  groups: Schema.NonEmptyArray(openStruct({ layers: Schema.Array(Schema.Unknown) })),
});

type IconManifest = typeof IconManifest.Type;

export const decodeIconManifest = Schema.decodeUnknownSync(IconManifest);

const decodeManifestText = Schema.decodeUnknownEffect(Schema.fromJsonString(IconManifest));

const BAND = "dev.svg";

/** The Icon Composer manifest with the DEV band as the front layer, out of the glass. */
export function devIconManifest({ groups: [front, ...back], ...rest }: IconManifest): IconManifest {
  const band = { "image-name": BAND, name: "dev", glass: false };

  return { ...rest, groups: [{ ...front, layers: [band, ...front.layers] }, ...back] };
}

const devLog = (message: string) => Console.log(`[desktop:dev] ${message}`);

/** Runs `command`, failing with all it printed when it exits with anything but 0. */
const runOrFail = Effect.fnUntraced(function* (command: string, ...args: Array<string>) {
  const shown = [command, ...args].join(" ");

  const result = yield* run(command, args).pipe(
    Effect.mapError(
      (error) => new DevAppFailed({ message: `\`${shown}\` failed: ${error.message}` }),
    ),
  );

  // actool reports its errors on stdout.
  if (result.code !== 0) {
    const printed = `${result.stdout}\n${result.stderr}`.trim();

    return yield* new DevAppFailed({ message: `\`${shown}\` failed: ${printed}` });
  }
});

/** The Cutfac Dev executable, built on first use. macOS only. */
export const devElectron = Effect.fn("devApp.devElectron")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const electron = path.join(root, "node_modules", "electron");
  const cache = path.join(root, "node_modules", ".cache", "cutfac-dev");
  const bundle = path.join(cache, `${DEV_APP.name}.app`);
  const executable = path.join(bundle, "Contents", "MacOS", "Electron");
  const stampFile = path.join(cache, "stamp.json");

  const icon = {
    source: path.join(root, "build", "icon.icon"),
    band: path.join(root, "build", "icon-dev-badge.svg"),
  };

  const { version } = yield* fs
    .readFileString(path.join(electron, "package.json"))
    .pipe(Effect.flatMap(decodePackage));

  const stamp = JSON.stringify({ electron: version, ...DEV_APP, icon: yield* hashIcon(icon) });

  if (Option.contains(yield* Effect.option(fs.readFileString(stampFile)), stamp)) return executable;

  yield* fs.remove(cache, { recursive: true, force: true });
  yield* fs.makeDirectory(cache, { recursive: true });
  // -c clones on APFS, so the copy is instant and takes no space; -R keeps the framework symlinks.
  yield* runOrFail("cp", "-Rc", path.join(electron, "dist", "Electron.app"), bundle);

  const plist = path.join(bundle, "Contents", "Info.plist");

  for (const [key, value] of [
    ["CFBundleIdentifier", DEV_APP.bundleId],
    ["CFBundleName", DEV_APP.name],
    ["CFBundleDisplayName", DEV_APP.name],
  ] as const) {
    yield* runOrFail("/usr/libexec/PlistBuddy", "-c", `Set :${key} "${value}"`, plist);
  }

  // Electron's own icon is no reason to stop: the app runs the same without the band.
  const iconSet = yield* setIcon(icon, path.join(cache, "icon"), bundle).pipe(
    Effect.as(true),
    Effect.catch((error) =>
      Effect.as(
        devLog(
          `Could not give ${DEV_APP.name} its icon (it needs Xcode 26), keeping Electron's: ${error.message}`,
        ),
        false,
      ),
    ),
  );

  // The edits break Electron's signature, and Apple silicon will not run an unsigned app.
  yield* runOrFail("codesign", "--force", "--deep", "--sign", "-", bundle);

  // Last, so a copy cut short is rebuilt on the next run, and a missing icon is tried again.
  if (iconSet) yield* fs.writeFileString(stampFile, stamp);

  return executable;
});

type IconSources = { source: string; band: string };

/** A digest of every file that goes into the icon, so a change to any of them rebuilds it. */
const hashIcon = Effect.fnUntraced(function* ({ source, band }: IconSources) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const encoder = new TextEncoder();

  const entries = yield* fs.readDirectory(source, { recursive: true });

  const files = yield* Effect.filter(
    entries.map((entry) => path.join(source, entry)).toSorted(),
    (file) => Effect.map(fs.stat(file), (info) => info.type === "File"),
  );

  // Each file's path from the icon, then its bytes, in one stream.
  const parts = yield* Effect.forEach([...files, band], (file) =>
    Effect.map(fs.readFile(file), (bytes) => [encoder.encode(path.relative(source, file)), bytes]),
  );

  const all = parts.flat();
  const joined = new Uint8Array(all.reduce((size, part) => size + part.length, 0));

  all.reduce((offset, part) => {
    joined.set(part, offset);

    return offset + part.length;
  }, 0);

  return Hex.encode(yield* crypto.digest("SHA-256", joined));
});

/** Compiles the Cutfac icon with the DEV band into `bundle`, as the Liquid Glass icon and the icns. */
const setIcon = Effect.fnUntraced(function* (
  { source, band }: IconSources,
  work: string,
  bundle: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const document = path.join(work, "Icon.icon");
  const out = path.join(work, "out");
  const manifest = path.join(document, "icon.json");

  yield* fs.makeDirectory(out, { recursive: true });
  yield* runOrFail("cp", "-R", source, document);
  yield* fs.copyFile(band, path.join(document, "Assets", BAND));

  const shipped = yield* fs.readFileString(manifest).pipe(Effect.flatMap(decodeManifestText));

  yield* fs.writeFileString(manifest, JSON.stringify(devIconManifest(shipped)));
  // Writes Assets.car, which macOS 26 draws by CFBundleIconName, and Icon.icns for older systems.
  yield* runOrFail(
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
  );

  const resources = path.join(bundle, "Contents", "Resources");

  yield* fs.copyFile(path.join(out, "Assets.car"), path.join(resources, "Assets.car"));
  // Info.plist names electron.icns as the icon file, so the icns takes its place.
  yield* fs.copyFile(path.join(out, "Icon.icns"), path.join(resources, "electron.icns"));
  yield* runOrFail(
    "/usr/libexec/PlistBuddy",
    "-c",
    "Add :CFBundleIconName string Icon",
    path.join(bundle, "Contents", "Info.plist"),
  );
});
