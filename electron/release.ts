/**
 * `bun run release:desktop`: builds the mac app, signs and notarizes it, and uploads it to the
 * private release bucket. Apps and the download page reach it through cutfac.com, which checks the
 * license key and hands out short-lived links. Credentials come from .env.release; nothing here
 * prints their values.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { Option, Schema } from "effect";

const root = path.resolve(import.meta.dir, "..");

const outputDir = path.join(root, "release");

export const REQUIRED_ENV = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CUTFAC_RELEASES_BUCKET",
  "CUTFAC_RELEASES_REGION",
] as const;

/** The bucket folder the site serves builds from. */
const FOLDER = "mac";

const FEED_FILE = "latest-mac.yml";

const CONTENT_TYPES = new Map([
  [".dmg", "application/x-apple-diskimage"],
  [".zip", "application/zip"],
  [".blockmap", "application/octet-stream"],
]);

const decodeFeed = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.NonEmptyString }));

const decodePackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.NonEmptyString }));

/** The names in `REQUIRED_ENV` that are unset or empty. */
export function missingEnv(env: Record<string, string | undefined>): string[] {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

/** The version a feed file announces, or undefined when it names none. */
export function feedVersion(feed: string): string | undefined {
  return Option.getOrUndefined(decodeFeed(Bun.YAML.parse(feed)))?.version;
}

/** Why `version` cannot be released over `published`, or undefined when it can. */
export function versionProblem(version: string, published: string | undefined): string | undefined {
  if (published === undefined || Bun.semver.order(version, published) > 0) return undefined;

  return `package.json is at ${version}, but ${published} is already published. Bump the version first.`;
}

/** A build to upload and the type the bucket serves it with. */
export interface BuildFile {
  name: string;
  type: string;
}

/**
 * The builds of `version` among `files`, in upload order: the disk image people install, the zip
 * apps update from, and their blockmaps. Throws when either build is missing.
 */
export function buildFiles(version: string, files: readonly string[]): BuildFile[] {
  const prefix = `cutfac-${version}-arm64.`;

  const builds = files.toSorted().flatMap((name) => {
    const type = CONTENT_TYPES.get(path.extname(name));

    return name.startsWith(prefix) && type ? [{ name, type }] : [];
  });

  for (const needed of [`${prefix}dmg`, `${prefix}zip`]) {
    if (!builds.some((build) => build.name === needed)) {
      throw new Error(`The build did not produce ${needed}.`);
    }
  }

  return builds;
}

function setting(name: (typeof REQUIRED_ENV)[number]): string {
  const value = process.env[name];

  if (!value) throw new Error(`Set ${name} in .env.release.`);

  return value;
}

function bucket(): Bun.S3Client {
  return new Bun.S3Client({
    bucket: setting("CUTFAC_RELEASES_BUCKET"),
    region: setting("CUTFAC_RELEASES_REGION"),
    accessKeyId: setting("AWS_ACCESS_KEY_ID"),
    secretAccessKey: setting("AWS_SECRET_ACCESS_KEY"),
  });
}

async function publishedVersion(releases: Bun.S3Client): Promise<string | undefined> {
  const feed = releases.file(`${FOLDER}/${FEED_FILE}`);

  if (!(await feed.exists())) return undefined;

  return feedVersion(await feed.text());
}

async function upload(releases: Bun.S3Client, { name, type }: BuildFile): Promise<void> {
  console.log(`[release] Uploading ${name}.`);
  await releases.write(`${FOLDER}/${name}`, Bun.file(path.join(outputDir, name)), { type });
}

async function run(command: string[]): Promise<void> {
  const code = await Bun.spawn(command, { cwd: root, stdio: ["inherit", "inherit", "inherit"] })
    .exited;

  if (code !== 0) throw new Error(`\`${command.join(" ")}\` exited with code ${code}.`);
}

async function release(): Promise<void> {
  const missing = missingEnv(process.env);

  if (missing.length > 0) {
    throw new Error(`Set ${missing.join(", ")} in .env.release (see README, Releasing the app).`);
  }

  const { version } = decodePackage(await Bun.file(path.join(root, "package.json")).json());

  const releases = bucket();
  const problem = versionProblem(version, await publishedVersion(releases));

  if (problem) throw new Error(problem);

  console.log(`[release] Building Cutfac ${version}.`);
  await run(["bun", "run", "build"]);
  await run(["bun", "run", "build:sidecar"]);
  await run(["bun", "run", "build:electron"]);

  // Fails instead of building an unsigned app when the Developer ID certificate is missing. The
  // feed file is still written; this script uploads it, since the bucket is not a builder target.
  await run([
    path.join(root, "node_modules", ".bin", "electron-builder"),
    "--mac",
    "--publish",
    "never",
    "-c.mac.forceCodeSigning=true",
  ]);

  const feed = Bun.file(path.join(outputDir, FEED_FILE));

  // The feed is what makes a version live, so a stale one must never go up.
  if (!(await feed.exists()) || feedVersion(await feed.text()) !== version) {
    throw new Error(`The build did not produce a ${FEED_FILE} for ${version}.`);
  }

  for (const build of buildFiles(version, await readdir(outputDir))) {
    await upload(releases, build);
  }

  // Last, so no app or download page sees the version before its files are there.
  await upload(releases, { name: FEED_FILE, type: "text/yaml" });

  console.log(`[release] Published ${version}. cutfac.com/download now hands it out.`);
}

if (import.meta.main) {
  try {
    await release();
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
