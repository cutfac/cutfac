import { Effect, FileSystem, Option, Path, Schema } from "effect";

import type { AgentName } from "../src/core/schema.ts";
import type { AgentSetup } from "../web/src/desktop.ts";

// Where the app keeps its workspaces: one folder of its own, `~/Movies/Cutfac` by default, with each
// workspace a folder in its `workspaces`. Movies, as macOS's video apps keep their libraries there:
// iCloud doesn't sync it as it can Desktop and Documents, and macOS doesn't ask before an agent
// reads it. The folder's own top level is left for what every workspace shares.

/** The folder in the app's own where the workspaces are. */
export const WORKSPACES = "workspaces";

/** What a workspace folder holds at its root; `factory.yaml` is its name from before Cutfac. */
const CONFIGS = ["cutfac.yaml", "factory.yaml"];

/**
 * A workspace's name, which is its folder's name: one level, nothing hidden, and nothing Finder or
 * a shell reads as part of a path.
 */
export const WorkspaceName = Schema.Trim.pipe(
  Schema.decodeTo(
    Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(64),
      // oxlint-disable-next-line no-control-regex -- control characters are what it rules out
      Schema.isPattern(/^(?!\.)[^/\\:\u0000-\u001f]+$/),
    ),
  ),
);

export const decodeWorkspaceName = Schema.decodeUnknownOption(WorkspaceName);

/** One workspace in the app's folder. */
export interface LibraryWorkspace {
  name: string;
  path: string;
}

const isWorkspace = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  for (const config of CONFIGS) {
    if (yield* fs.exists(path.join(dir, config))) return true;
  }

  return false;
});

/** The workspaces in `library`, by name; none while it has no `workspaces` folder yet. */
export const listWorkspaces = Effect.fn("library.list")(function* (library: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = path.join(library, WORKSPACES);

  const names = yield* fs.readDirectory(dir).pipe(Effect.orElseSucceed((): string[] => []));
  const found: LibraryWorkspace[] = [];

  for (const name of names.toSorted((a, b) => a.localeCompare(b))) {
    const target = path.join(dir, name);

    if (Option.isSome(decodeWorkspaceName(name)) && (yield* isWorkspace(target))) {
      found.push({ name, path: target });
    }
  }

  return found;
});

/** Where a workspace named `name` goes, made, or why it can't be. */
export type Prepared =
  | { readonly kind: "ready"; readonly path: string }
  | { readonly kind: "taken" };

/**
 * Makes the folder for a workspace named `name` in `library`. A workspace already there is taken,
 * unless `reuse`, as on a first launch after a reinstall; a folder with something else in it is
 * taken either way.
 */
export const prepareWorkspace = Effect.fn("library.prepare")(function* (
  library: string,
  name: string,
  reuse: boolean,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const target = path.join(library, WORKSPACES, name);

  if (yield* fs.exists(target)) {
    if (yield* isWorkspace(target)) {
      return reuse ? ({ kind: "ready", path: target } as const) : ({ kind: "taken" } as const);
    }

    const entries = yield* fs.readDirectory(target);

    if (entries.some((entry) => !entry.startsWith("."))) return { kind: "taken" } as const;
  }

  yield* fs.makeDirectory(target, { recursive: true });

  return { kind: "ready", path: target } as const;
});

/** How many names it tries, `name`, `name 2` and on, before giving up on a free one. */
const MAX_TRIES = 9;

/** The agents in the order the first one ready runs the reading. */
const ORDER: ReadonlyArray<AgentName> = ["claude", "codex"];

/** `name`, then `name 2`, `name 3` and on. */
export const candidateNames = (name: string): string[] =>
  Array.from({ length: MAX_TRIES }, (_, index) => (index === 0 ? name : `${name} ${index + 1}`));

/** The agent that reads: Claude Code when it is ready, else the first that is. */
export const readingAgent = (
  setups: ReadonlyArray<Pick<AgentSetup, "agent" | "state">>,
): AgentName | undefined =>
  ORDER.find((agent) => setups.some((setup) => setup.agent === agent && setup.state === "ready"));

/** A source as the user typed it and as learning saved it, to tell one learned already. */
export const sameSource = (given: string, saved: string) => {
  const bare = (text: string) =>
    text
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");

  return bare(given) === bare(saved);
};
