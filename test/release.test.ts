import { describe, expect, test } from "bun:test";

import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, Option, Result } from "effect";

import { release } from "../electron/release.ts";
import {
  branchProblem,
  buildFiles,
  feedVersion,
  missingSettings,
  releaseArgs,
  releaseNotes,
  REQUIRED_ENV,
  signingProblem,
  tagName,
  treeProblem,
  versionProblem,
} from "../electron/releasePlan.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

/** What `security find-identity -v -p codesigning` prints for the keychain's `names`. */
const identities = (...names: string[]) =>
  [
    ...names.map((name, index) => `  ${index + 1}) ${"A".repeat(40)} "${name}"`),
    `     ${names.length} valid identities found`,
  ].join("\n");

describe("the release command", () => {
  test("releases package.json's version, or bumps it by what it is given", () => {
    expect(releaseArgs([])).toEqual(Option.some({ increment: Option.none(), checkAgents: true }));
    expect(releaseArgs(["patch"])).toEqual(
      Option.some({ increment: Option.some("patch"), checkAgents: true }),
    );
    expect(releaseArgs(["1.2.3"])).toEqual(
      Option.some({ increment: Option.some("1.2.3"), checkAgents: true }),
    );
  });

  test("checks the agent CLIs first, unless told to skip it", () => {
    expect(releaseArgs(["--skip-agent-check"])).toEqual(
      Option.some({ increment: Option.none(), checkAgents: false }),
    );
    expect(releaseArgs(["patch", "--skip-agent-check"])).toEqual(
      Option.some({ increment: Option.some("patch"), checkAgents: false }),
    );
    expect(releaseArgs(["--skip-agent-check", "1.2.3"])).toEqual(
      Option.some({ increment: Option.some("1.2.3"), checkAgents: false }),
    );
  });

  it.effect.each([
    { args: ["patch", "minor"] },
    { args: ["--help"] },
    { args: ["patch", "minor", "--skip-agent-check"] },
  ])("shows how to use it, the skip too, for $args before checking anything", ({ args }) =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(release(args));

      expect(error.message).toStartWith("Usage: bun run release");
      expect(error.message).toContain("[--skip-agent-check]");
    }),
  );
});

const missingFrom = (env: Record<string, string>) =>
  missingSettings.pipe(
    Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })),
  );

describe("desktop release checks", () => {
  it.effect("names the unset and empty settings, never their values", () =>
    Effect.gen(function* () {
      const env = Object.fromEntries(REQUIRED_ENV.map((name) => [name, "set"]));
      const { CUTFAC_RELEASES_BUCKET: _, ...withoutBucket } = env;

      expect(yield* missingFrom(env)).toEqual([]);
      expect(yield* missingFrom({ ...withoutBucket, APPLE_ID: "" })).toEqual([
        "APPLE_ID",
        "CUTFAC_RELEASES_BUCKET",
      ]);
    }),
  );

  test("reads the version a feed announces", () => {
    const feed = [
      "version: 0.2.0",
      "files:",
      "  - url: cutfac-0.2.0-arm64.zip",
      "    sha512: abc",
      "path: cutfac-0.2.0-arm64.zip",
      "releaseDate: '2026-10-16T00:00:00.000Z'",
    ].join("\n");

    expect(feedVersion(feed)).toEqual(Option.some("0.2.0"));
    expect(feedVersion("files: []")).toEqual(Option.none());
    expect(feedVersion("")).toEqual(Option.none());
  });

  test("only a newer version may go out", () => {
    expect(versionProblem("0.1.0", Option.none())).toEqual(Option.none());
    expect(versionProblem("0.2.0", Option.some("0.1.0"))).toEqual(Option.none());
    expect(versionProblem("0.10.0", Option.some("0.9.0"))).toEqual(Option.none());
    expect(versionProblem("1.0.0", Option.some("1.0.0-beta.2"))).toEqual(Option.none());
    expect(Option.getOrThrow(versionProblem("0.1.0", Option.some("0.1.0")))).toContain(
      "bun run release patch",
    );
    expect(Option.getOrThrow(versionProblem("0.1.0", Option.some("0.2.0")))).toContain(
      "0.2.0 is already published",
    );
  });

  test("uploads this version's disk image, zip and blockmaps, and nothing else", () => {
    const outputs = [
      "latest-mac.yml",
      "cutfac-0.2.0-arm64.zip.blockmap",
      "cutfac-0.2.0-arm64.zip",
      "cutfac-0.2.0-arm64.dmg",
      "cutfac-0.2.0-arm64.dmg.blockmap",
      "cutfac-0.1.0-arm64.dmg",
      "cutfac-0.2.0-arm64.zip.tmp",
      "builder-debug.yml",
      "mac-arm64",
    ];

    expect(buildFiles("0.2.0", outputs)).toEqual(
      Result.succeed([
        { name: "cutfac-0.2.0-arm64.dmg", type: "application/x-apple-diskimage" },
        { name: "cutfac-0.2.0-arm64.dmg.blockmap", type: "application/octet-stream" },
        { name: "cutfac-0.2.0-arm64.zip", type: "application/zip" },
        { name: "cutfac-0.2.0-arm64.zip.blockmap", type: "application/octet-stream" },
      ]),
    );
  });

  test("releases only from main, caught up with origin", () => {
    expect(branchProblem("main", 0)).toEqual(Option.none());
    expect(branchProblem("feature", 0)).toEqual(Option.some("Release from main, not feature."));
    expect(branchProblem("", 0)).toEqual(Option.some("Release from main, not a detached HEAD."));
    expect(Option.getOrThrow(branchProblem("main", 2))).toContain("2 commit(s) behind origin/main");
  });

  test("signs only with a Developer ID Application certificate for the team", () => {
    const developerId = "Developer ID Application: Someone (TEAM1)";

    expect(
      signingProblem(identities("Apple Development: Someone (TEAM1)", developerId), "TEAM1"),
    ).toEqual(Option.none());
    // Names the variable, never its value.
    expect(signingProblem(identities(developerId), "TEAM2")).toEqual(
      Option.some(
        "The keychain has no valid Developer ID Application certificate for APPLE_TEAM_ID.",
      ),
    );
    expect(Option.isSome(signingProblem("     0 valid identities found", "TEAM1"))).toBe(true);
  });

  test("refuses to publish without both the disk image and the zip", () => {
    expect(buildFiles("0.2.0", ["cutfac-0.2.0-arm64.zip"])).toEqual(
      Result.fail("The build did not produce cutfac-0.2.0-arm64.dmg."),
    );
    expect(buildFiles("0.2.0", ["cutfac-0.2.0-arm64.dmg"])).toEqual(
      Result.fail("The build did not produce cutfac-0.2.0-arm64.zip."),
    );
  });
});

describe("release tagging", () => {
  test("releases only a tree that matches its commit", () => {
    const problem = (status: string) => Option.getOrElse(treeProblem(status), () => "");

    expect(treeProblem("")).toEqual(Option.none());
    // Notes and folders a build never reads cannot change it.
    expect(treeProblem("?? docs/guides/\n?? .github/workflows/\n")).toEqual(Option.none());
    expect(problem(" M src/core/item.ts\n?? docs/guides/\n")).toBe(
      "Commit or stash src/core/item.ts first, so the release matches a commit.",
    );
    expect(problem("?? web/src/new.tsx\n?? notes.txt\nM  package.json\n")).toContain(
      "web/src/new.tsx, notes.txt, package.json",
    );
    // Any other folder may feed the build, like the skill the server bundles.
    expect(problem("?? skills/cutfac/extra.md\n")).toContain("skills/cutfac/extra.md");
    // A change to a tracked file anywhere counts, even where untracked notes do not.
    expect(problem(" M docs/guides/a.md")).toContain("docs/guides/a.md");
  });

  test("tags a version with a v", () => {
    expect(tagName("0.2.0")).toBe("v0.2.0");
  });

  test("lists the changes people notice, grouped, with their scope", () => {
    const notes = releaseNotes([
      "feat(core)!: drop STATUS.md item discovery",
      "fix(board): show a sent request as working right away",
      "docs: add security policy",
      "feat: compare variations side by side",
      "perf(server): stream frames",
      "chore: package metadata",
      "Merge branch 'main'",
    ]);

    expect(notes).toBe(
      [
        "### Breaking changes",
        "",
        "- **core:** drop STATUS.md item discovery",
        "",
        "### Features",
        "",
        "- compare variations side by side",
        "",
        "### Fixes",
        "",
        "- **board:** show a sent request as working right away",
        "",
        "### Performance",
        "",
        "- **server:** stream frames",
        "",
        "The signed Mac app is at https://cutfac.com and updates itself. To build it yourself, see the README.",
        "",
      ].join("\n"),
    );
  });

  test("says so when only maintenance changed", () => {
    expect(releaseNotes(["docs: fix a typo", "test: cover tags"])).toStartWith(
      "Maintenance and documentation changes.\n\n",
    );
    expect(releaseNotes([])).toStartWith("Maintenance and documentation changes.");
  });
});
