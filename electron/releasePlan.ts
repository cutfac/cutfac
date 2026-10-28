import path from "node:path";

import { Config, Effect, Option, Redacted, Result, Schema } from "effect";

import { fromYamlString } from "../src/core/configText.ts";
import { scriptLog } from "./script.ts";

export class ReleaseFailed extends Schema.TaggedError<ReleaseFailed>()("ReleaseFailed", {
  message: Schema.String,
}) {}

export const log = scriptLog("release");

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

export interface ReleaseArgs {
  readonly increment: Option.Option<string>;
  readonly checkAgents: boolean;
}

export function releaseArgs(args: ReadonlyArray<string>): Option.Option<ReleaseArgs> {
  const [increment, ...rest] = args.filter((arg) => arg !== SKIP_AGENT_CHECK);

  if (rest.length > 0 || increment?.startsWith("-")) return Option.none();

  return Option.some({
    increment: Option.fromUndefinedOr(increment),
    checkAgents: !args.includes(SKIP_AGENT_CHECK),
  });
}

/**
 * A setting from .env.release, or none when it is unset or empty. It stays redacted, so a log or
 * an error can't show it, until the one place that needs its value takes it out.
 */
export const releaseSetting = (name: ReleaseSetting) =>
  Config.option(Config.Redacted(name)).pipe(
    Effect.orElseSucceed(Option.none<Redacted.Redacted<string>>),
  );

/** The settings .env.release leaves unset or empty, by name, never their values. */
export const missingSettings = Effect.filter(REQUIRED_ENV, (name) =>
  Effect.map(releaseSetting(name), Option.isNone),
);

export const feedVersion = (feed: string) => Option.map(decodeFeed(feed), ({ version }) => version);

export function versionProblem(
  version: string,
  published: Option.Option<string>,
): Option.Option<string> {
  return Option.map(
    Option.filter(published, (newest) => Bun.semver.order(version, newest) <= 0),
    (newest) => `package.json is at ${version}, but ${newest} is already published. ${BUMP}`,
  );
}

const OUTSIDE_BUILD = ["docs/", ".github/", "test/"];

const inBuild = (file: string) => !OUTSIDE_BUILD.some((dir) => file.startsWith(dir));

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

export function branchProblem(branch: string, behind: number): Option.Option<string> {
  if (branch !== BRANCH) {
    return Option.some(`Release from ${BRANCH}, not ${branch || "a detached HEAD"}.`);
  }

  if (behind > 0) {
    return Option.some(`${BRANCH} is ${behind} commit(s) behind origin/${BRANCH}. Pull first.`);
  }

  return Option.none();
}

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

export interface BuildFile {
  readonly name: string;
  readonly type: string;
}

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
