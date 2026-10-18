/**
 * `bun run release:desktop`: builds the mac app, signs and notarizes it, and uploads it to the
 * private release bucket. Apps and the download page reach it through cutfac.com, which checks the
 * license key and hands out short-lived links. Then it tags the commit it built and publishes a
 * source-only GitHub release. Credentials come from .env.release; nothing here prints their values.
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

/** Folders a build never reads, so an untracked file there, like a note in docs/, cannot change it. */
const OUTSIDE_BUILD = ["docs/", ".github/", "test/"];

const inBuild = (file: string) => !OUTSIDE_BUILD.some((dir) => file.startsWith(dir));

/**
 * Why the working tree cannot be released, from `git status --porcelain`, or undefined when it
 * can. The release is tagged at HEAD, so the build must be exactly that commit.
 */
export function treeProblem(status: string): string | undefined {
  const dirty = status
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const file = line.slice(3);

      return line.startsWith("??") && !inBuild(file) ? [] : [file];
    });

  if (dirty.length === 0) return undefined;

  return `Commit or stash ${dirty.join(", ")} first, so the release matches a commit.`;
}

export const tagName = (version: string) => `v${version}`;

const COMMIT = /^(?<type>\w+)(?:\((?<scope>[^)]+)\))?(?<breaking>!)?: (?<text>.+)$/;

const SECTIONS = [
  ["breaking", "Breaking changes"],
  ["feat", "Features"],
  ["fix", "Fixes"],
  ["perf", "Performance"],
] as const;

const FOOTER =
  "The signed Mac app is at https://cutfac.com and updates itself. To build it yourself, see the README.";

/**
 * Release notes from the subjects of the commits since the last release, in Conventional Commits.
 * Only changes people notice make the list; docs, tests, and chores stay out.
 */
export function releaseNotes(subjects: readonly string[]): string {
  const entries = subjects.flatMap((subject) => {
    const groups = COMMIT.exec(subject)?.groups;

    if (groups?.["type"] === undefined || groups["text"] === undefined) return [];

    const scope = groups["scope"] === undefined ? "" : `**${groups["scope"]}:** `;
    const section = groups["breaking"] === undefined ? groups["type"] : "breaking";

    return [{ section, line: `- ${scope}${groups["text"]}` }];
  });

  const sections = SECTIONS.flatMap(([key, title]) => {
    const lines = entries.flatMap((entry) => (entry.section === key ? [entry.line] : []));

    return lines.length === 0 ? [] : [`### ${title}\n\n${lines.join("\n")}`];
  });

  const body =
    sections.length === 0 ? "Maintenance and documentation changes." : sections.join("\n\n");

  return `${body}\n\n${FOOTER}\n`;
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

/** What `command` prints, without the final newline, or undefined when it fails. */
async function output(command: string[]): Promise<string | undefined> {
  const child = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "ignore" });
  const text = await new Response(child.stdout).text();

  // Only the end: `git status` starts lines with a space.
  return (await child.exited) === 0 ? text.trimEnd() : undefined;
}

/** The subjects of the commits up to `commit` since the release tag before it, or all of them. */
async function subjectsSinceRelease(commit: string): Promise<string[]> {
  const previous = await output([
    "git",
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
    commit,
  ]);

  const range = previous === undefined ? commit : `${previous}..${commit}`;
  const log = await output(["git", "log", "--format=%s", range]);

  return log === undefined || log === "" ? [] : log.split("\n");
}

/**
 * Tag the commit that was built, push the tag, and publish a source-only GitHub release. The builds
 * are live by now, so a failure here only leaves the remaining steps to run by hand.
 */
async function publishTag(version: string, commit: string, notes: string): Promise<void> {
  const tag = tagName(version);
  const notesFile = path.join(outputDir, `notes-${version}.md`);

  await Bun.write(notesFile, notes);

  const steps = [
    ["git", "tag", "-a", tag, commit, "-m", `Cutfac ${version}`],
    ["git", "push", "origin", tag],
    [
      "gh",
      "release",
      "create",
      tag,
      "--verify-tag",
      "--title",
      `Cutfac ${version}`,
      "--notes-file",
      notesFile,
    ],
  ];

  for (const [index, step] of steps.entries()) {
    try {
      await run(step);
    } catch (error) {
      const left = steps.slice(index).map((command) => command.join(" "));

      const message = error instanceof Error ? error.message : String(error);

      console.error(`[release] ${message} Run the rest yourself:\n  ${left.join("\n  ")}`);
      process.exitCode = 1;

      return;
    }
  }

  console.log(`[release] Tagged ${tag} and published its GitHub release.`);
}

async function release(): Promise<void> {
  const missing = missingEnv(process.env);

  if (missing.length > 0) {
    throw new Error(`Set ${missing.join(", ")} in .env.release (see README, Releasing the app).`);
  }

  const status = await output(["git", "status", "--porcelain"]);
  const commit = await output(["git", "rev-parse", "HEAD"]);

  if (status === undefined || commit === undefined) throw new Error("Run this in a git checkout.");

  const dirty = treeProblem(status);

  if (dirty) throw new Error(dirty);

  const { version } = decodePackage(await Bun.file(path.join(root, "package.json")).json());

  if (await output(["git", "rev-parse", "--quiet", "--verify", `refs/tags/${tagName(version)}`])) {
    throw new Error(`${tagName(version)} is already tagged. Bump the version first.`);
  }

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

  await publishTag(version, commit, releaseNotes(await subjectsSinceRelease(commit)));
}

if (import.meta.main) {
  try {
    await release();
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
