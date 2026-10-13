import { Crypto, Effect, Schema } from "effect";
import { Hex } from "effect/encoding";

import { readOptionalText } from "./library.ts";
import { SKILL_MARKDOWN } from "./templates.ts";
import { Workspace } from "./workspace.ts";

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
