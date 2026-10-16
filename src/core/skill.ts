import { Crypto, Effect, Schema } from "effect";
import { Hex } from "effect/encoding";

import { readOptionalText } from "./library.ts";
import { SKILL_MARKDOWN } from "./templates.ts";
import { Workspace, foldersWith } from "./workspace.ts";

/** Where Claude Code and Codex look for a workspace's Agent Skills. */
export const SKILL_FOLDERS = [".agents/skills", ".claude/skills"] as const;

/** The workspace's copies of the content-factory skill, one per agent. */
export const SKILL_PATHS = SKILL_FOLDERS.map((folder) => `${folder}/content-factory/SKILL.md`);

/** The skill this build ships, and every version an earlier build may have installed. */
export interface BundledSkill {
  readonly markdown: string;
  /** SHA-256 of each shipped SKILL.md. A copy that matches one was never edited. */
  readonly shipped: ReadonlySet<string>;
}

/**
 * Add the new hash here whenever skills/content-factory/SKILL.md changes; a test fails until you
 * do. Without it, workspaces holding the version before would keep it as if it had been edited.
 */
export const BUNDLED_SKILL: BundledSkill = {
  markdown: SKILL_MARKDOWN,
  shipped: new Set([
    "ef0501e47ff81d1b383734236ed0615965469e192272a39f4f56a82cb939e04b",
    "51d287154a2e5cbec9750f7dd30c796ecf2a548d43cd6bf1be3f0e3b5e0736b7",
    "8254064c75f3fe5074d23a78e0d1d6673f99c1062ebbbb18671db9933e2e8c58",
    "0fa4776b40b7406bf65c16020bc00dfcc4d3d8268b9057569236b724bba9d7e3",
    "1cd48e116658fed5f5b25003473624c6f1547a78481fd55af078e18ab2c5b775",
    "c317fe8f814c97613f45bb61a5dd98b25dd6ef85255d378ef19713acb93d1d7e",
    "03dc511d76e195c7078e92e8880f043234fb1cbfbb9e655d9364d33fedd25727",
    "fab66f849167911e3cf99803fc635fd54d7ff9ffbed327c72487c3479c677626",
    "1fc9a73ad42d047fdcaa2b154f4290147caf08b28067e79726ae0c419d4a1c70",
    "5461ec17badf4a522af2969313a88a8c218c9cd765a5c86bfb9deb81ab4f400d",
    "86c8ce1bc8dd07dd2d554e762b1a5f95ca435b50240c105eb04fcf915a1b246a",
    "3551f566440a1f2331ab9f93ba46219634c24139f79fc0de03efda64ce6f07fa",
    "b9e13649e8cb4ee6a345bcf97c17ab602b058ae203b5800fd60dcfa07d3b98f0",
    "f002b87b5b209d35de0d8d338f68dbb824dd430e53f03a7f7ea70b054efda8a4",
    "adb83db1c490598ab2487c79767ce6258bbadacdaaa22bf72063f3a100147a6a",
  ]),
};

/** Hex SHA-256, as `BundledSkill.shipped` lists them. */
export const sha256 = Effect.fn("skill.sha256")(function* (text: string) {
  const crypto = yield* Crypto.Crypto;
  const digest = yield* Effect.orDie(crypto.digest("SHA-256", new TextEncoder().encode(text)));

  return Hex.encode(digest);
});

/** Outdated: an earlier shipped version. Edited: anything else, which only a person may replace. */
export const SkillState = Schema.Literals(["missing", "current", "outdated", "edited"]);

export type SkillState = typeof SkillState.Type;

export interface SkillCopy {
  readonly path: string;
  readonly state: SkillState;
}

/** The copies `syncSkill` writes. */
export const isStale = (copy: SkillCopy) => copy.state === "missing" || copy.state === "outdated";

const stateOf = Effect.fnUntraced(function* (
  text: string | undefined,
  skill: BundledSkill,
): Effect.fn.Return<SkillState, never, Crypto.Crypto> {
  if (text === undefined) return "missing";

  if (text === skill.markdown) return "current";

  return skill.shipped.has(yield* sha256(text)) ? "outdated" : "edited";
});

/** Each copy of the skill and how it compares with the bundled one. */
export const skillCopies = Effect.fn("skill.skillCopies")(function* (
  skill: BundledSkill = BUNDLED_SKILL,
) {
  return yield* Effect.forEach(SKILL_PATHS, (path) =>
    Effect.gen(function* () {
      const text = yield* readOptionalText(path);

      return { path, state: yield* stateOf(text, skill) } satisfies SkillCopy;
    }),
  );
});

/**
 * Install missing copies and replace outdated ones, so a workspace made by an earlier version gets
 * the current skill without anyone running a command. Edited copies are left as they are. Returns
 * each copy's state before the sync.
 */
export const syncSkill = Effect.fn("skill.syncSkill")(function* (
  skill: BundledSkill = BUNDLED_SKILL,
) {
  const ws = yield* Workspace;
  const copies = yield* skillCopies(skill);

  yield* Effect.forEach(copies.filter(isStale), (copy) => ws.writeText(copy.path, skill.markdown), {
    discard: true,
  });

  return copies;
});

const SKILL_FILE = "SKILL.md";

/** The names of the skills in each skill folder, in `SKILL_FOLDERS` order. */
const skillsByFolder = Effect.forEach(SKILL_FOLDERS, (folder) => foldersWith(folder, SKILL_FILE));

/** Every skill installed in the workspace, in either folder, sorted by name. */
export const installedSkills = Effect.fn("skill.installedSkills")(function* () {
  const folders = yield* skillsByFolder;

  return [...new Set(folders.flat())].toSorted((a, b) => a.localeCompare(b));
});

/**
 * Copy each skill that is not in `known` to every skill folder missing it, from the first folder
 * that has it, so Claude Code and Codex both find a skill an agent installed where it could
 * write. A copy that fails is logged and skipped. Returns the names copied.
 */
export const mirrorSkills = Effect.fn("skill.mirrorSkills")(function* (
  known: ReadonlyArray<string>,
) {
  const ws = yield* Workspace;
  const byFolder = yield* skillsByFolder;
  const folders = SKILL_FOLDERS.map((folder, index) => ({ folder, names: byFolder[index] ?? [] }));
  const skip = new Set(known);

  const copies = [...new Set(byFolder.flat())]
    .filter((name) => !skip.has(name))
    .flatMap((name) => {
      const source = folders.find((entry) => entry.names.includes(name));

      if (source === undefined) return [];

      return folders.flatMap((entry) =>
        entry.names.includes(name)
          ? []
          : [{ name, from: `${source.folder}/${name}`, to: `${entry.folder}/${name}` }],
      );
    });

  const copied = yield* Effect.forEach(copies, ({ name, from, to }) =>
    ws.copyTree(from, to).pipe(
      Effect.as([name]),
      Effect.catch((error) => Effect.as(Effect.logWarning(error.message), [])),
    ),
  );

  return copied.flat();
});

/** What the agent should do about copies that are not current. Agent-facing, so in English. */
export function skillNotices(copies: ReadonlyArray<SkillCopy>): string[] {
  return copies.flatMap(({ path, state }) => {
    switch (state) {
      case "current":
        return [];
      case "edited":
        return [
          `${path} differs from the content-factory skill this version of Content Factory ships, ` +
            "so it was left as it is. Call get_skill, tell the user what is new, and with their " +
            "consent merge it into that file, keeping their own changes.",
        ];
      default:
        return [`${path} is ${state}. Call get_skill and write its markdown to that path.`];
    }
  });
}
