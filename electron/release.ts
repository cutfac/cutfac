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
// @effect-diagnostics strictEffectProvide:off
import path from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Config, Console, Effect, FileSystem, Option, Result, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { run as runCaptured } from "../src/core/process.ts";
import {
  BRANCH,
  BUMP,
  type BuildFile,
  type ReleaseArgs,
  type ReleaseSetting,
  USAGE,
  branchProblem,
  buildFiles,
  feedVersion,
  missingEnv,
  releaseArgs,
  releaseNotes,
  signingProblem,
  tagName,
  treeProblem,
  versionProblem,
} from "./releasePlan.ts";

const root = path.resolve(import.meta.dir, "..");

const outputDir = path.join(root, "release");

const packageFile = path.join(root, "package.json");

/** What CI runs on every push besides the build, so no release ships what CI would fail. */
const CHECKS = [
  ["bun", "test"],
  ["bun", "run", "typecheck"],
  ["bun", "run", "lint"],
  ["bun", "run", "format:check"],
] as const;

/**
 * The agent CLIs against Cutfac's parsers, which makes real model calls and needs both CLIs
 * installed and signed in. A release that cannot run it, or does not need to, skips it. It saves
 * nothing, so the tree stays what the release is tagged at.
 */
const AGENT_CHECK = ["bun", "run", "check:agents", "--no-save"] as const;

/** The bucket folder the site serves builds from. */
const FOLDER = "mac";

const FEED_FILE = "latest-mac.yml";

export class ReleaseFailed extends Schema.TaggedError<ReleaseFailed>()("ReleaseFailed", {
  message: Schema.String,
}) {}

const decodePackage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ version: Schema.NonEmptyString })),
);

const log = (message: string) => Console.log(`[release] ${message}`);

const setting = (name: ReleaseSetting) =>
  Config.option(Config.String(name)).pipe(
    Effect.orElseSucceed(Option.none<string>),
    Effect.flatMap(
      Option.match({
        onNone: () => Effect.fail(new ReleaseFailed({ message: `Set ${name} in .env.release.` })),
        onSome: (value) =>
          value === ""
            ? Effect.fail(new ReleaseFailed({ message: `Set ${name} in .env.release.` }))
            : Effect.succeed(value),
      }),
    ),
  );

const run = Effect.fnUntraced(function* (command: ReadonlyArray<string>) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const [program = "", ...args] = command;
  const shown = command.join(" ");

  const code = yield* Effect.scoped(
    Effect.flatMap(
      spawner.spawn(
        ChildProcess.make(program, args, {
          cwd: root,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      ),
      (handle) => handle.exitCode,
    ),
  ).pipe(
    Effect.mapError((error) => new ReleaseFailed({ message: `\`${shown}\` ${error.message}` })),
  );

  if (code !== 0)
    return yield* new ReleaseFailed({ message: `\`${shown}\` exited with code ${code}.` });
});

const output = (command: ReadonlyArray<string>) => {
  const [program = "", ...args] = command;

  return runCaptured(program, args, { cwd: root }).pipe(
    // Only the end: `git status` starts lines with a space.
    Effect.map((result) =>
      result.code === 0 ? Option.some(result.stdout.trimEnd()) : Option.none<string>(),
    ),
    Effect.orElseSucceed(Option.none<string>),
  );
};

const releaseBucket = Effect.gen(function* () {
  const s3 = new Bun.S3Client({
    bucket: yield* setting("CUTFAC_RELEASES_BUCKET"),
    region: yield* setting("CUTFAC_RELEASES_REGION"),
    accessKeyId: yield* setting("AWS_ACCESS_KEY_ID"),
    secretAccessKey: yield* setting("AWS_SECRET_ACCESS_KEY"),
  });

  const failed = (what: string) => (cause: unknown) =>
    new ReleaseFailed({
      message: `${what}: ${cause instanceof Error ? cause.message : String(cause)}`,
    });

  const published = Effect.tryPromise({
    try: async () => {
      const feed = s3.file(`${FOLDER}/${FEED_FILE}`);

      return (await feed.exists()) ? Option.some(await feed.text()) : Option.none<string>();
    },
    catch: failed(`Couldn't read ${FOLDER}/${FEED_FILE} in the bucket`),
  }).pipe(Effect.map(Option.flatMap(feedVersion)));

  const upload = ({ name, type }: BuildFile) =>
    Effect.andThen(
      log(`Uploading ${name}.`),
      Effect.tryPromise({
        try: () => s3.write(`${FOLDER}/${name}`, Bun.file(path.join(outputDir, name)), { type }),
        catch: failed(`Couldn't upload ${name}`),
      }),
    );

  return { published, upload };
});

type ReleaseBucket = Effect.Success<typeof releaseBucket>;

/** The subjects of the commits up to `commit` since the release tag before it, or all of them. */
const subjectsSinceRelease = Effect.fnUntraced(function* (commit: string) {
  const previous = yield* output([
    "git",
    "describe",
    "--tags",
    "--abbrev=0",
    "--match",
    "v*",
    commit,
  ]);

  const range = Option.match(previous, {
    onNone: () => commit,
    onSome: (tag) => `${tag}..${commit}`,
  });

  const subjects = yield* output(["git", "log", "--format=%s", range]);

  return Option.match(
    Option.filter(subjects, (text) => text !== ""),
    {
      onNone: (): Array<string> => [],
      onSome: (text) => text.split("\n"),
    },
  );
});

/** What stops a release, found in seconds so that nothing fails for it after the long build. */
const preflight = Effect.gen(function* () {
  const missing = missingEnv(process.env);

  const team = Option.filter(
    Option.fromUndefinedOr(process.env["APPLE_TEAM_ID"]),
    (id) => id !== "",
  );

  const fetched = yield* output(["git", "fetch", "--quiet", "origin", BRANCH]);

  const [status, branch, behind, identities, github] = yield* Effect.all(
    [
      output(["git", "status", "--porcelain"]),
      output(["git", "branch", "--show-current"]),
      output(["git", "rev-list", "--count", `HEAD..origin/${BRANCH}`]),
      output(["security", "find-identity", "-v", "-p", "codesigning"]),
      output(["gh", "auth", "status"]),
    ],
    { concurrency: "unbounded" },
  );

  const problems: Array<Option.Option<string>> = [
    missing.length === 0
      ? Option.none()
      : Option.some(
          `Set ${missing.join(", ")} in .env.release (see docs/desktop.md, Releasing the app).`,
        ),
    Option.match(status, {
      onNone: () => Option.some("Run this in a git checkout."),
      onSome: treeProblem,
    }),
    Option.isNone(fetched)
      ? Option.some(`Couldn't fetch origin/${BRANCH}.`)
      : branchProblem(
          Option.getOrElse(branch, () => ""),
          Number(Option.getOrElse(behind, () => "0")),
        ),
    Option.flatMap(team, (id) =>
      signingProblem(
        Option.getOrElse(identities, () => ""),
        id,
      ),
    ),
    Option.isNone(github) ? Option.some("Log in to GitHub with `gh auth login`.") : Option.none(),
  ];

  return problems.flatMap(Option.toArray);
});

const packageVersion = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return (yield* fs.readFileString(packageFile).pipe(Effect.flatMap(decodePackage))).version;
});

/** Refuses a version that is already tagged, or not newer than the one the bucket serves. */
const refuseReleased = Effect.fnUntraced(function* (version: string, bucket: ReleaseBucket) {
  const tagged = yield* output([
    "git",
    "rev-parse",
    "--quiet",
    "--verify",
    `refs/tags/${tagName(version)}`,
  ]);

  if (Option.exists(tagged, (commit) => commit !== "")) {
    return yield* new ReleaseFailed({ message: `${tagName(version)} is already tagged. ${BUMP}` });
  }

  const problem = versionProblem(version, yield* bucket.published);

  if (Option.isSome(problem)) return yield* new ReleaseFailed({ message: problem.value });
});

/**
 * The version to release once it is new and passes CI's checks: package.json's, or the one
 * `bun pm version` bumps it to. The bump is committed only after the checks pass; until then a
 * failure puts package.json back, so the next try starts from the same tree.
 */
const checkedVersion = Effect.fnUntraced(function* (
  { increment, checkAgents }: ReleaseArgs,
  bucket: ReleaseBucket,
) {
  const fs = yield* FileSystem.FileSystem;
  const original = yield* fs.readFileString(packageFile);

  if (Option.isSome(increment)) {
    yield* run(["bun", "pm", "version", increment.value, "--no-git-tag-version"]);
  }

  const checked = Effect.gen(function* () {
    const version = yield* packageVersion;

    yield* refuseReleased(version, bucket);
    yield* log(`Running CI's checks on ${version}.`);
    yield* Effect.forEach(CHECKS, run, { discard: true });

    if (checkAgents) {
      yield* log("Checking the installed agent CLIs against Cutfac's parsers.");
      yield* run(AGENT_CHECK);
    }

    if (Option.isSome(increment)) {
      yield* run([
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
  });

  return yield* Option.isSome(increment)
    ? checked.pipe(Effect.onError(() => Effect.ignore(fs.writeFileString(packageFile, original))))
    : checked;
});

/** Where the GitHub release's notes are written. */
const notesPath = (version: string) => path.join(outputDir, `notes-${version}.md`);

const publishSource = Effect.fnUntraced(function* (version: string, commit: string, notes: string) {
  const fs = yield* FileSystem.FileSystem;
  const tag = tagName(version);
  const notesFile = notesPath(version);

  yield* fs.writeFileString(notesFile, notes);

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
    const failed = yield* Effect.flip(run(step)).pipe(Effect.option);

    if (Option.isSome(failed)) {
      const left = steps.slice(index).map((command) => command.join(" "));

      yield* Console.error(
        `[release] ${failed.value.message} Run the rest yourself:\n  ${left.join("\n  ")}`,
      );

      return 1;
    }
  }

  yield* log(`Pushed ${BRANCH} with ${tag} and published its GitHub release.`);

  return 0;
});

export const release = Effect.fn("release")(function* (args: ReadonlyArray<string>) {
  const fs = yield* FileSystem.FileSystem;
  const asked = releaseArgs(args);

  if (Option.isNone(asked)) return yield* new ReleaseFailed({ message: USAGE });

  const problems = yield* preflight;

  if (problems.length > 0) {
    return yield* new ReleaseFailed({
      message: `Fix these first:\n  - ${problems.join("\n  - ")}`,
    });
  }

  const bucket = yield* releaseBucket;
  const version = yield* checkedVersion(asked.value, bucket);
  const commit = yield* output(["git", "rev-parse", "HEAD"]);

  if (Option.isNone(commit)) {
    return yield* new ReleaseFailed({ message: "Couldn't read the commit to release." });
  }

  yield* log(`Building Cutfac ${version}.`);
  yield* run(["bun", "run", "build"]);
  yield* run(["bun", "run", "build:sidecar"]);
  yield* run(["bun", "run", "build:electron"]);

  // Fails instead of building an unsigned app when the Developer ID certificate is missing. The
  // feed file is still written; this script uploads it, since the bucket is not a builder target.
  yield* run([
    path.join(root, "node_modules", ".bin", "electron-builder"),
    "--mac",
    "--publish",
    "never",
    "-c.mac.forceCodeSigning=true",
  ]);

  const feed = yield* fs.readFileString(path.join(outputDir, FEED_FILE)).pipe(Effect.option);

  // The feed is what makes a version live, so a stale one must never go up.
  if (!Option.contains(Option.flatMap(feed, feedVersion), version)) {
    return yield* new ReleaseFailed({
      message: `The build did not produce a ${FEED_FILE} for ${version}.`,
    });
  }

  const builds = buildFiles(version, yield* fs.readDirectory(outputDir));

  if (Result.isFailure(builds)) return yield* new ReleaseFailed({ message: builds.failure });

  yield* Effect.forEach(builds.success, bucket.upload, { discard: true });

  yield* bucket.upload({ name: FEED_FILE, type: "text/yaml" });
  yield* log(`Published ${version}. cutfac.com/download now hands it out.`);

  const code = yield* publishSource(
    version,
    commit.value,
    releaseNotes(yield* subjectsSinceRelease(commit.value)),
  );

  // The site's changelog is written by hand for people using the app, so nothing here can add it.
  yield* log(
    `Next, add ${version} to cutfac.com/changelog, from ${path.relative(root, notesPath(version))}.`,
  );

  return code;
});

if (import.meta.main) {
  process.exitCode = await Effect.runPromise(
    release(Bun.argv.slice(2)).pipe(
      Effect.catch((error) => Effect.as(Console.error(`[release] ${error.message}`), 1)),
      Effect.provide(BunServices.layer),
    ),
  );
}
