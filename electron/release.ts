/**
 * `bun run release:desktop`: builds the mac app, signs and notarizes it, uploads it to the update
 * feed, and clears the CDN's copy of the feed so running apps see it right away. Credentials come
 * from .env.release; nothing here prints their values.
 */
import path from "node:path";

import { Option, Schema } from "effect";

const root = path.resolve(import.meta.dir, "..");

export const REQUIRED_ENV = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "CLOUDFRONT_DISTRIBUTION_ID",
] as const;

const FEED_FILE = "latest-mac.yml";

const decodeFeed = Schema.decodeUnknownOption(Schema.Struct({ version: Schema.NonEmptyString }));

const decodePackage = Schema.decodeUnknownSync(Schema.Struct({ version: Schema.NonEmptyString }));

const decodeBuilderConfig = Schema.decodeUnknownSync(
  Schema.Struct({ publish: Schema.Array(Schema.Struct({ url: Schema.String })) }),
);

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

interface Feed {
  /** Where apps read the feed from. */
  url: string;
  /** The CDN path of the feed file, for clearing its cached copy. */
  cdnPath: string;
}

/** The feed is the first `publish` entry in electron-builder.yml, the same one the app reads. */
async function readFeed(): Promise<Feed> {
  const config = Bun.YAML.parse(await Bun.file(path.join(root, "electron-builder.yml")).text());
  const url = decodeBuilderConfig(config).publish[0]?.url;

  if (url === undefined) throw new Error("electron-builder.yml has no publish url.");

  return { url, cdnPath: `${new URL(url).pathname}/${FEED_FILE}` };
}

async function publishedVersion(feedUrl: string): Promise<string | undefined> {
  const response = await fetch(`${feedUrl}/${FEED_FILE}?noCache=${Date.now()}`);

  // The bucket is private, so a file that is not there yet reads as 403 through the CDN.
  if (response.status === 403 || response.status === 404) return undefined;

  if (!response.ok) throw new Error(`Could not read the published feed (HTTP ${response.status}).`);

  return feedVersion(await response.text());
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

  if (!Bun.which("aws")) throw new Error("The AWS CLI (`aws`) is needed to refresh the CDN.");

  const { version } = decodePackage(await Bun.file(path.join(root, "package.json")).json());

  const feed = await readFeed();
  const problem = versionProblem(version, await publishedVersion(feed.url));

  if (problem) throw new Error(problem);

  console.log(`[release] Building Cutfac ${version}.`);
  await run(["bun", "run", "build"]);
  await run(["bun", "run", "build:sidecar"]);
  await run(["bun", "run", "build:electron"]);

  // Fails instead of publishing an unsigned app when the Developer ID certificate is missing.
  await run([
    path.join(root, "node_modules", ".bin", "electron-builder"),
    "--mac",
    "--publish",
    "always",
    "-c.mac.forceCodeSigning=true",
  ]);

  await run([
    "aws",
    "cloudfront",
    "create-invalidation",
    "--distribution-id",
    process.env.CLOUDFRONT_DISTRIBUTION_ID ?? "",
    "--paths",
    feed.cdnPath,
  ]);

  console.log(`[release] Published ${version} to ${feed.url}.`);
}

if (import.meta.main) {
  try {
    await release();
  } catch (error) {
    console.error(`[release] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
