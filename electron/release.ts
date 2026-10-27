/**
 * `bun run release [patch | minor | major | <version>] [--skip-agent-check]` ships the Mac app in
 * one command. It first checks everything the release needs, so nothing turns up missing after the
 * long build. Then it bumps the version with `bun pm version` when given one, runs CI's checks, and
 * checks that the installed claude and codex CLIs still work with Cutfac, which the flag leaves
 * out. It builds, signs and notarizes the app, and uploads it to the private release bucket, the
 * update feed last. Apps and the download page reach it through short-lived cutfac.com links, with
 * no license key. Last, it pushes main with a `v<version>` tag and publishes a source-only GitHub
 * release. Credentials come from .env.release; nothing here prints their values.
 */
import { readdir } from "node:fs/promises";
import path from "node:path";

import { Option, Schema } from "effect";

const root = path.resolve(import.meta.dir, "..");

const outputDir = path.join(root, "release");

const packageFile = path.join(root, "package.json");

/** The branch releases are made from, and pushed to with their tag. */
const BRANCH = "main";

const USAGE = "Usage: bun run release [patch | minor | major | <version>] [--skip-agent-check]";

const SKIP_AGENT_CHECK = "--skip-agent-check";

const BUMP = "Bump it with `bun run release patch` (or minor, major).";

/** What CI runs on every push besides the build, so no release ships what CI would fail. */
const CHECKS = [
  ["bun", "test"],
  ["bun", "run", "typecheck"],
  ["bun", "run", "lint"],
  ["bun", "run", "format:check"],
];

/**
 * The agent CLIs against Cutfac's parsers, which makes real model calls and needs both CLIs
 * installed and signed in. A release that cannot run it, or does not need to, skips it. It saves
 * nothing, so the tree stays what the release is tagged at.
 */
const AGENT_CHECK = ["bun", "run", "check:agents", "--no-save"];

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

/**
 * The version bump `bun run release` was given, which `bun pm version` checks, or undefined to
 * release the version package.json is at.
 */
export function incrementFrom(args: readonly string[]): string | undefined {
  const [increment, ...rest] = args;

  if (rest.length > 0 || increment?.startsWith("-")) throw new Error(USAGE);

  return increment;
}

/** What `bun run release` was asked to do: the version bump, and whether to check the agent CLIs. */
export interface ReleaseArgs {
  readonly increment: string | undefined;
  readonly checkAgents: boolean;
}

/** `incrementFrom` for the arguments that are left once `--skip-agent-check` is taken out. */
export function releaseArgs(args: readonly string[]): ReleaseArgs {
  return {
    increment: incrementFrom(args.filter((arg) => arg !== SKIP_AGENT_CHECK)),
    checkAgents: !args.includes(SKIP_AGENT_CHECK),
  };
}

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

  return `package.json is at ${version}, but ${published} is already published. ${BUMP}`;
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

/** Why the checkout cannot be released from, given its branch and how far it is behind origin. */
export function branchProblem(branch: string, behind: number): string | undefined {
  if (branch !== BRANCH) return `Release from ${BRANCH}, not ${branch || "a detached HEAD"}.`;

  if (behind > 0) return `${BRANCH} is ${behind} commit(s) behind origin/${BRANCH}. Pull first.`;

  return undefined;
}

/**
 * Why the keychain cannot sign the app, from `security find-identity -v -p codesigning`, or
 * undefined when it holds a valid Developer ID Application certificate for `team`.
 */
export function signingProblem(identities: string, team: string): string | undefined {
  const signs = identities
    .split("\n")
    .some((line) => line.includes('"Developer ID Application: ') && line.endsWith(`(${team})"`));

  return signs
    ? undefined
    : "The keychain has no valid Developer ID Application certificate for APPLE_TEAM_ID.";
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

/** What stops a release, found in seconds so that nothing fails for it after the long build. */
async function preflight(): Promise<string[]> {
  const missing = missingEnv(process.env);
  const team = process.env["APPLE_TEAM_ID"];
  const fetched = await output(["git", "fetch", "--quiet", "origin", BRANCH]);

  const [status, branch, behind, identities, github] = await Promise.all([
    output(["git", "status", "--porcelain"]),
    output(["git", "branch", "--show-current"]),
    output(["git", "rev-list", "--count", `HEAD..origin/${BRANCH}`]),
    output(["security", "find-identity", "-v", "-p", "codesigning"]),
    output(["gh", "auth", "status"]),
  ]);

  return [
    missing.length === 0
      ? undefined
      : `Set ${missing.join(", ")} in .env.release (see docs/desktop.md, Releasing the app).`,
    status === undefined ? "Run this in a git checkout." : treeProblem(status),
    fetched === undefined
      ? `Couldn't fetch origin/${BRANCH}.`
      : branchProblem(branch ?? "", Number(behind ?? 0)),
    team ? signingProblem(identities ?? "", team) : undefined,
    github === undefined ? "Log in to GitHub with `gh auth login`." : undefined,
  ].filter((problem) => problem !== undefined);
}

async function packageVersion(): Promise<string> {
  return decodePackage(await Bun.file(packageFile).json()).version;
}

/** Refuses a version that is already tagged, or not newer than the one the bucket serves. */
async function refuseReleased(version: string, releases: Bun.S3Client): Promise<void> {
  if (await output(["git", "rev-parse", "--quiet", "--verify", `refs/tags/${tagName(version)}`])) {
    throw new Error(`${tagName(version)} is already tagged. ${BUMP}`);
  }

  const problem = versionProblem(version, await publishedVersion(releases));

  if (problem) throw new Error(problem);
}

/**
 * The version to release once it is new and passes CI's checks: package.json's, or the one
 * `bun pm version` bumps it to. The bump is committed only after the checks pass; until then a
 * failure puts package.json back, so the next try starts from the same tree.
 */
async function checkedVersion(
  { increment, checkAgents }: ReleaseArgs,
  releases: Bun.S3Client,
): Promise<string> {
  const original = await Bun.file(packageFile).text();

  if (increment !== undefined) {
    await run(["bun", "pm", "version", increment, "--no-git-tag-version"]);
  }

  try {
    const version = await packageVersion();

    await refuseReleased(version, releases);
    console.log(`[release] Running CI's checks on ${version}.`);

    for (const check of CHECKS) await run(check);

    if (checkAgents) {
      console.log("[release] Checking the installed agent CLIs against Cutfac's parsers.");
      await run(AGENT_CHECK);
    }

    if (increment !== undefined) {
      await run([
        "git",
        "commit",
        "--quiet",
        "-m",
        `chore(release): ${version}`,
        "--",
        "package.json",
      ]);
    }

    return version;
  } catch (error) {
    if (increment !== undefined) await Bun.write(packageFile, original);

    throw error;
  }
}

/** Where the GitHub release's notes are written. */
function notesPath(version: string): string {
  return path.join(outputDir, `notes-${version}.md`);
}

/**
 * Tag the commit that was built, push it to main with the tag, and publish a source-only GitHub
 * release. The builds are live by now, so a failure here only leaves the remaining steps to run by
 * hand.
 */
async function publishSource(version: string, commit: string, notes: string): Promise<void> {
  const tag = tagName(version);
  const notesFile = notesPath(version);

  await Bun.write(notesFile, notes);

  const steps = [
    ["git", "tag", "-a", tag, commit, "-m", `Cutfac ${version}`],
    // Atomic, so GitHub gets main and its tag together or neither.
    ["git", "push", "--atomic", "origin", BRANCH, `refs/tags/${tag}`],
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

  console.log(`[release] Pushed ${BRANCH} with ${tag} and published its GitHub release.`);
}

async function release(args: ReleaseArgs): Promise<void> {
  const problems = await preflight();

  if (problems.length > 0) throw new Error(`Fix these first:\n  - ${problems.join("\n  - ")}`);

  const releases = bucket();
  const version = await checkedVersion(args, releases);
  const commit = await output(["git", "rev-parse", "HEAD"]);

  if (commit === undefined) throw new Error("Couldn't read the commit to release.");

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

  await publishSource(version, commit, releaseNotes(await subjectsSinceRelease(commit)));

  // The site's changelog is written by hand for people using the app, so nothing here can add it.
  console.log(
    `[release] Next, add ${version} to cutfac.com/changelog, from ${path.relative(root, notesPath(version))}.`,
  );
}

if (import.meta.main) {
  try {
    await release(releaseArgs(Bun.argv.slice(2)));
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
