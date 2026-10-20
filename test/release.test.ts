import { describe, expect, test } from "bun:test";

import {
  branchProblem,
  buildFiles,
  feedVersion,
  incrementFrom,
  missingEnv,
  releaseNotes,
  REQUIRED_ENV,
  signingProblem,
  tagName,
  treeProblem,
  versionProblem,
} from "../electron/release.ts";

/** What `security find-identity -v -p codesigning` prints for the keychain's `names`. */
const identities = (...names: string[]) =>
  [
    ...names.map((name, index) => `  ${index + 1}) ${"A".repeat(40)} "${name}"`),
    `     ${names.length} valid identities found`,
  ].join("\n");

describe("the release command", () => {
  test("releases package.json's version, or bumps it by what it is given", () => {
    expect(incrementFrom([])).toBeUndefined();
    expect(incrementFrom(["patch"])).toBe("patch");
    expect(incrementFrom(["1.2.3"])).toBe("1.2.3");
  });

  test("shows how to use it when given more, or a flag", () => {
    expect(() => incrementFrom(["patch", "minor"])).toThrow("Usage: bun run release");
    expect(() => incrementFrom(["--help"])).toThrow("Usage: bun run release");
  });
});

describe("desktop release checks", () => {
  test("names the unset and empty variables, never their values", () => {
    const env = Object.fromEntries(REQUIRED_ENV.map((name) => [name, "set"]));

    expect(missingEnv(env)).toEqual([]);
    expect(missingEnv({ ...env, APPLE_ID: "", CUTFAC_RELEASES_BUCKET: undefined })).toEqual([
      "APPLE_ID",
      "CUTFAC_RELEASES_BUCKET",
    ]);
  });

  test("reads the version a feed announces", () => {
    const feed = [
      "version: 0.2.0",
      "files:",
      "  - url: cutfac-0.2.0-arm64.zip",
      "    sha512: abc",
      "path: cutfac-0.2.0-arm64.zip",
      "releaseDate: '2026-10-16T00:00:00.000Z'",
    ].join("\n");

    expect(feedVersion(feed)).toBe("0.2.0");
    expect(feedVersion("files: []")).toBeUndefined();
    expect(feedVersion("")).toBeUndefined();
  });

  test("only a newer version may go out", () => {
    expect(versionProblem("0.1.0", undefined)).toBeUndefined();
    expect(versionProblem("0.2.0", "0.1.0")).toBeUndefined();
    expect(versionProblem("0.10.0", "0.9.0")).toBeUndefined();
    expect(versionProblem("1.0.0", "1.0.0-beta.2")).toBeUndefined();
    expect(versionProblem("0.1.0", "0.1.0")).toContain("bun run release patch");
    expect(versionProblem("0.1.0", "0.2.0")).toContain("0.2.0 is already published");
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

    expect(buildFiles("0.2.0", outputs)).toEqual([
      { name: "cutfac-0.2.0-arm64.dmg", type: "application/x-apple-diskimage" },
      { name: "cutfac-0.2.0-arm64.dmg.blockmap", type: "application/octet-stream" },
      { name: "cutfac-0.2.0-arm64.zip", type: "application/zip" },
      { name: "cutfac-0.2.0-arm64.zip.blockmap", type: "application/octet-stream" },
    ]);
  });

  test("releases only from main, caught up with origin", () => {
    expect(branchProblem("main", 0)).toBeUndefined();
    expect(branchProblem("feature", 0)).toBe("Release from main, not feature.");
    expect(branchProblem("", 0)).toBe("Release from main, not a detached HEAD.");
    expect(branchProblem("main", 2)).toContain("2 commit(s) behind origin/main");
  });

  test("signs only with a Developer ID Application certificate for the team", () => {
    const developerId = "Developer ID Application: Someone (TEAM1)";

    expect(
      signingProblem(identities("Apple Development: Someone (TEAM1)", developerId), "TEAM1"),
    ).toBeUndefined();
    expect(signingProblem(identities("Apple Development: Someone (TEAM1)"), "TEAM1")).toContain(
      "no valid Developer ID Application certificate",
    );
    // Names the variable, never its value.
    expect(signingProblem(identities(developerId), "TEAM2")).toBe(
      "The keychain has no valid Developer ID Application certificate for APPLE_TEAM_ID.",
    );
    expect(signingProblem("     0 valid identities found", "TEAM1")).toBeDefined();
  });

  test("refuses to publish without both the disk image and the zip", () => {
    expect(() => buildFiles("0.2.0", ["cutfac-0.2.0-arm64.zip"])).toThrow(
      "did not produce cutfac-0.2.0-arm64.dmg",
    );
    expect(() => buildFiles("0.2.0", ["cutfac-0.2.0-arm64.dmg"])).toThrow(
      "did not produce cutfac-0.2.0-arm64.zip",
    );
  });
});

describe("release tagging", () => {
  test("releases only a tree that matches its commit", () => {
    expect(treeProblem("")).toBeUndefined();
    // Notes and folders a build never reads cannot change it.
    expect(treeProblem("?? docs/guides/\n?? .github/workflows/\n")).toBeUndefined();
    expect(treeProblem(" M src/core/item.ts\n?? docs/guides/\n")).toBe(
      "Commit or stash src/core/item.ts first, so the release matches a commit.",
    );
    expect(treeProblem("?? web/src/new.tsx\n?? notes.txt\nM  package.json\n")).toContain(
      "web/src/new.tsx, notes.txt, package.json",
    );
    // Any other folder may feed the build, like the skill the server bundles.
    expect(treeProblem("?? skills/cutfac/extra.md\n")).toContain("skills/cutfac/extra.md");
    // A change to a tracked file anywhere counts, even where untracked notes do not.
    expect(treeProblem(" M docs/guides/a.md")).toContain("docs/guides/a.md");
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
