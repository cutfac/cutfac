import { expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem } from "effect";

import { sha256 } from "../src/core/crypto.ts";
import {
  BUNDLED_SKILL,
  type BundledSkill,
  SKILL_PATHS,
  skillCopies,
  skillNotices,
  syncSkill,
} from "../src/core/skill.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("skill"));

const SKILL_FILE = join(import.meta.dir, "../skills/cutfac/SKILL.md");

const [AGENTS_COPY = "", CLAUDE_COPY = ""] = SKILL_PATHS;

const write = (rel: string, text: string) =>
  Effect.flatMap(Workspace, (ws) => ws.writeText(rel, text));

const read = (rel: string) => Effect.flatMap(Workspace, (ws) => ws.readText(rel));

/** The skill at "v2", after a version that read `earlier`. */
const skillAfter = (earlier: string) =>
  Effect.map(sha256(earlier), (hash): BundledSkill => ({
    markdown: "v2",
    shipped: new Set([hash]),
  }));

it.live("the bundled skill is listed as shipped, so the next version can replace it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const text = yield* fs.readFileString(SKILL_FILE);

    expect(BUNDLED_SKILL.markdown).toBe(text);
    expect(BUNDLED_SKILL.shipped.has(yield* sha256(text))).toBe(true);
  }),
);

it.live("installs the skill for both agents in a workspace that has none", () =>
  Effect.gen(function* () {
    const before = yield* syncSkill();

    expect(before.map((copy) => copy.state)).toEqual(["missing", "missing"]);
    expect(yield* read(AGENTS_COPY)).toBe(BUNDLED_SKILL.markdown);
    expect(yield* read(CLAUDE_COPY)).toBe(BUNDLED_SKILL.markdown);
    expect(yield* skillCopies()).toEqual([
      { path: AGENTS_COPY, state: "current" },
      { path: CLAUDE_COPY, state: "current" },
    ]);
  }),
);

it.live("replaces a copy an earlier version installed, and keeps one the user edited", () =>
  Effect.gen(function* () {
    yield* write(AGENTS_COPY, "v1");
    yield* write(CLAUDE_COPY, "v1 with my own rules");

    const before = yield* Effect.flatMap(skillAfter("v1"), syncSkill);

    expect(before).toEqual([
      { path: AGENTS_COPY, state: "outdated" },
      { path: CLAUDE_COPY, state: "edited" },
    ]);
    expect(yield* read(AGENTS_COPY)).toBe("v2");
    expect(yield* read(CLAUDE_COPY)).toBe("v1 with my own rules");

    const after = yield* Effect.flatMap(skillAfter("v1"), skillCopies);
    const notices = skillNotices(after);

    expect(notices).toHaveLength(1);
    expect(notices[0]).toContain(CLAUDE_COPY);
    expect(notices[0]).toContain("get_skill");
    expect(notices[0]).toContain("consent");
  }),
);

it.live("a current copy needs nothing", () =>
  Effect.gen(function* () {
    yield* write(AGENTS_COPY, "v2");
    yield* write(CLAUDE_COPY, "v2");

    const before = yield* Effect.flatMap(skillAfter("v1"), syncSkill);

    expect(skillNotices(before)).toEqual([]);
  }),
);

test("asks the agent to write a copy the sync could not", () => {
  expect(skillNotices([{ path: AGENTS_COPY, state: "missing" }])).toEqual([
    `${AGENTS_COPY} is missing. Call get_skill and write its markdown to that path.`,
  ]);
});
