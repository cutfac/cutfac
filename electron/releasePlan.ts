import path from "node:path";

import { Option, Result, Schema } from "effect";

import { fromYamlString } from "../src/core/configText.ts";

/** The branch releases are made from, and pushed to with their tag. */
export const BRANCH = "main";

export const USAGE =
  "Usage: bun run release [patch | minor | major | <version>] [--skip-agent-check]";

const SKIP_AGENT_CHECK = "--skip-agent-check";

export const BUMP = "Bump it with `bun run release patch` (or minor, major).";

export const REQUIRED_ENV = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CUTFAC_RELEASES_BUCKET",
  "CUTFAC_RELEASES_REGION",
  "CUTFAC_POSTHOG_KEY",
] as const;

export type ReleaseSetting = (typeof REQUIRED_ENV)[number];

const CONTENT_TYPES = new Map([
  [".dmg", "application/x-apple-diskimage"],
  [".zip", "application/zip"],
  [".blockmap", "application/octet-stream"],
]);

const decodeFeed = Schema.decodeUnknownOption(
  fromYamlString(Schema.Struct({ version: Schema.NonEmptyString })),
);

/** What `bun run release` was asked to do: the version bump, and whether to check the agent CLIs. */
export interface ReleaseArgs {
  /** The bump `bun pm version` checks; none releases the version package.json is at. */
  readonly increment: Option.Option<string>;
  readonly checkAgents: boolean;
}

/** What `args` ask of a release once `--skip-agent-check` is taken out; none for a misuse. */
export function releaseArgs(args: ReadonlyArray<string>): Option.Option<ReleaseArgs> {
  const [increment, ...rest] = args.filter((arg) => arg !== SKIP_AGENT_CHECK);

  if (rest.length > 0 || increment?.startsWith("-")) return Option.none();

  return Option.some({
    increment: Option.fromUndefinedOr(increment),
    checkAgents: !args.includes(SKIP_AGENT_CHECK),
  });
}

/** The names in `REQUIRED_ENV` that are unset or empty. */
export function missingEnv(env: Readonly<Record<string, string | undefined>>): Array<string> {
  return REQUIRED_ENV.filter((name) => !env[name]);
}

/** The version a feed file announces, if it names one. */
export const feedVersion = (feed: string) => Option.map(decodeFeed(feed), ({ version }) => version);

/** Why `version` cannot be released over `published`, if it cannot. */
export function versionProblem(
  version: string,
  published: Option.Option<string>,
): Option.Option<string> {
  return Option.map(
    Option.filter(published, (newest) => Bun.semver.order(version, newest) <= 0),
    (newest) => `package.json is at ${version}, but ${newest} is already published. ${BUMP}`,
  );
}

/** Folders a build never reads, so an untracked file there, like a note in docs/, cannot change it. */
const OUTSIDE_BUILD = ["docs/", ".github/", "test/"];

const inBuild = (file: string) => !OUTSIDE_BUILD.some((dir) => file.startsWith(dir));

/**
 * Why the working tree cannot be released, from `git status --porcelain`, if it cannot. The
 * release is tagged at HEAD, so the build must be exactly that commit.
 */
export function treeProblem(status: string): Option.Option<string> {
  const dirty = status
    .split("\n")
    .filter((line) => line !== "")
    .flatMap((line) => {
      const file = line.slice(3);

      return line.startsWith("??") && !inBuild(file) ? [] : [file];
    });

  return dirty.length === 0
    ? Option.none()
    : Option.some(`Commit or stash ${dirty.join(", ")} first, so the release matches a commit.`);
}

/** Why the checkout cannot be released from, given its branch and how far it is behind origin. */
export function branchProblem(branch: string, behind: number): Option.Option<string> {
  if (branch !== BRANCH) {
    return Option.some(`Release from ${BRANCH}, not ${branch || "a detached HEAD"}.`);
  }

  if (behind > 0) {
    return Option.some(`${BRANCH} is ${behind} commit(s) behind origin/${BRANCH}. Pull first.`);
  }

  return Option.none();
}

/**
 * Why the keychain cannot sign the app, from `security find-identity -v -p codesigning`, unless it
 * holds a valid Developer ID Application certificate for `team`.
 */
export function signingProblem(identities: string, team: string): Option.Option<string> {
  const signs = identities
    .split("\n")
    .some((line) => line.includes('"Developer ID Application: ') && line.endsWith(`(${team})"`));

  return signs
    ? Option.none()
    : Option.some(
        "The keychain has no valid Developer ID Application certificate for APPLE_TEAM_ID.",
      );
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
export function releaseNotes(subjects: ReadonlyArray<string>): string {
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
  readonly name: string;
  readonly type: string;
}

/**
 * The builds of `version` among `files`, in upload order: the disk image people install, the zip
 * apps update from, and their blockmaps. Fails with the build that is missing, if one is.
 */
export function buildFiles(
  version: string,
  files: ReadonlyArray<string>,
): Result.Result<Array<BuildFile>, string> {
  const prefix = `cutfac-${version}-arm64.`;

  const builds = files.toSorted().flatMap((name) => {
    const type = CONTENT_TYPES.get(path.extname(name));

    return name.startsWith(prefix) && type ? [{ name, type }] : [];
  });

  const missing = [`${prefix}dmg`, `${prefix}zip`].find(
    (needed) => !builds.some((build) => build.name === needed),
  );

  return missing === undefined
    ? Result.succeed(builds)
    : Result.fail(`The build did not produce ${missing}.`);
}
