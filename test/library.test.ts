import { describe, expect, test } from "bun:test";

import { Effect, FileSystem, Option, Path } from "effect";

import {
  candidateNames,
  decodeWorkspaceName,
  listWorkspaces,
  prepareWorkspace,
  readingAgent,
  sameSource,
  WORKSPACES,
} from "../electron/library.ts";
import { nameFromSources } from "../web/src/lib/onboarding.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

/** The app's folder for the test, removed after it. */
const libraryFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "cutfac-library-" }),
);

describe("a workspace's name", () => {
  test("is its folder's name, trimmed", () => {
    expect(decodeWorkspaceName("  Launch videos ")).toEqual(Option.some("Launch videos"));
    expect(decodeWorkspaceName("내 영상")).toEqual(Option.some("내 영상"));
  });

  test("can't reach outside the app's folder, hide, or be empty", () => {
    for (const name of ["", "   ", "a/b", "..", ".hidden", "a:b", "a\\b", "x".repeat(65), 3]) {
      expect(decodeWorkspaceName(name)).toEqual(Option.none());
    }
  });
});

test("the first workspace is named for the website the user gave", () => {
  expect(nameFromSources(["https://www.cutfac.com/pricing"])).toBe("cutfac.com");
  expect(nameFromSources(["/Users/me/brand kit", "cutfac.com"])).toBe("cutfac.com");
  expect(nameFromSources(["/Users/me/brand kit"])).toBeUndefined();
  expect(nameFromSources([])).toBeUndefined();
});

describe("the app's folder", () => {
  it.live("makes a workspace in its workspaces folder, and lists only workspaces", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const library = yield* libraryFolder;

      expect(yield* listWorkspaces(library)).toEqual([]);

      const made = yield* prepareWorkspace(library, "Launch", false);
      const target = path.join(library, WORKSPACES, "Launch");

      expect(made).toEqual({ kind: "ready", path: target });

      yield* fs.writeFileString(path.join(target, "cutfac.yaml"), "name: Launch\n");
      yield* fs.makeDirectory(path.join(library, WORKSPACES, "Not one"));

      expect(yield* listWorkspaces(library)).toEqual([{ name: "Launch", path: target }]);
    }),
  );

  it.live("a name taken by a workspace opens it only when reused", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const library = yield* libraryFolder;
      const target = path.join(library, WORKSPACES, "Brand");

      yield* fs.makeDirectory(target, { recursive: true });
      yield* fs.writeFileString(path.join(target, "cutfac.yaml"), "name: Brand\n");

      expect(yield* prepareWorkspace(library, "Brand", false)).toEqual({ kind: "taken" });
      expect(yield* prepareWorkspace(library, "Brand", true)).toEqual({
        kind: "ready",
        path: target,
      });
    }),
  );

  it.live("a folder of the name with other things in it is taken either way", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const library = yield* libraryFolder;
      const target = path.join(library, WORKSPACES, "Photos");

      yield* fs.makeDirectory(target, { recursive: true });
      yield* fs.writeFileString(path.join(target, "notes.txt"), "mine\n");

      expect(yield* prepareWorkspace(library, "Photos", true)).toEqual({ kind: "taken" });
    }),
  );
});

describe("the first workspace's reading", () => {
  test("is run by Claude Code when it is ready, else by the agent that is", () => {
    expect(
      readingAgent([
        { agent: "codex", state: "ready" },
        { agent: "claude", state: "ready" },
      ]),
    ).toBe("claude");
    expect(
      readingAgent([
        { agent: "claude", state: "signedOut" },
        { agent: "codex", state: "ready" },
      ]),
    ).toBe("codex");
    expect(readingAgent([{ agent: "claude", state: "missing" }])).toBeUndefined();
  });

  test("learns a source once, however the user typed it", () => {
    expect(sameSource("cutfac.com", "https://www.cutfac.com/")).toBe(true);
    expect(sameSource(" https://cutfac.com ", "https://cutfac.com")).toBe(true);
    expect(sameSource("cutfac.com/pricing", "https://cutfac.com")).toBe(false);
  });

  test("tries the next name when one is taken", () => {
    expect(candidateNames("cutfac.com").slice(0, 3)).toEqual([
      "cutfac.com",
      "cutfac.com 2",
      "cutfac.com 3",
    ]);
  });
});
