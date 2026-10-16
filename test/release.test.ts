import { describe, expect, test } from "bun:test";

import { feedVersion, missingEnv, REQUIRED_ENV, versionProblem } from "../electron/release.ts";

describe("desktop release checks", () => {
  test("names the unset and empty variables, never their values", () => {
    const env = Object.fromEntries(REQUIRED_ENV.map((name) => [name, "set"]));

    expect(missingEnv(env)).toEqual([]);
    expect(missingEnv({ ...env, APPLE_ID: "", CLOUDFRONT_DISTRIBUTION_ID: undefined })).toEqual([
      "APPLE_ID",
      "CLOUDFRONT_DISTRIBUTION_ID",
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
    expect(versionProblem("0.1.0", "0.1.0")).toContain("Bump the version");
    expect(versionProblem("0.1.0", "0.2.0")).toContain("0.2.0 is already published");
  });
});
