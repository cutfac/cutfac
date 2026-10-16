import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Effect } from "effect";

import {
  BUNDLED_SKILL,
  type BundledSkill,
  SKILL_PATHS,
  sha256,
  skillCopies,
  skillNotices,
  syncSkill,
} from "../src/core/skill.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const SKILL_FILE = join(import.meta.dir, "../skills/cutfac/SKILL.md");

const [AGENTS_COPY = "", CLAUDE_COPY = ""] = SKILL_PATHS;

let t: TestWorkspace;

beforeEach(async () => {
  t = await makeWorkspace("skill");
});

afterEach(async () => {
  await t.remove();
});

const write = async (rel: string, text: string) => {
  await mkdir(dirname(join(t.root, rel)), { recursive: true });
  await writeFile(join(t.root, rel), text);
};

const read = (rel: string) => readFile(join(t.root, rel), "utf8");

/** The skill at "v2", after a version that read `earlier`. */
const skillAfter = (earlier: string) =>
  Effect.map(sha256(earlier), (hash): BundledSkill => ({
    markdown: "v2",
    shipped: new Set([hash]),
  }));

test("the bundled skill is listed as shipped, so the next version can replace it", async () => {
  const text = await readFile(SKILL_FILE, "utf8");

  expect(BUNDLED_SKILL.markdown).toBe(text);
  expect(BUNDLED_SKILL.shipped.has(await t.run(sha256(text)))).toBe(true);
});

test("installs the skill for both agents in a workspace that has none", async () => {
  const before = await t.run(syncSkill());

  expect(before.map((copy) => copy.state)).toEqual(["missing", "missing"]);
  expect(await read(AGENTS_COPY)).toBe(BUNDLED_SKILL.markdown);
  expect(await read(CLAUDE_COPY)).toBe(BUNDLED_SKILL.markdown);
  expect(await t.run(skillCopies())).toEqual([
    { path: AGENTS_COPY, state: "current" },
    { path: CLAUDE_COPY, state: "current" },
  ]);
});

test("replaces a copy an earlier version installed, and keeps one the user edited", async () => {
  await write(AGENTS_COPY, "v1");
  await write(CLAUDE_COPY, "v1 with my own rules");

  const before = await t.run(Effect.flatMap(skillAfter("v1"), syncSkill));

  expect(before).toEqual([
    { path: AGENTS_COPY, state: "outdated" },
    { path: CLAUDE_COPY, state: "edited" },
  ]);
  expect(await read(AGENTS_COPY)).toBe("v2");
  expect(await read(CLAUDE_COPY)).toBe("v1 with my own rules");

  const after = await t.run(Effect.flatMap(skillAfter("v1"), skillCopies));
  const notices = skillNotices(after);

  expect(notices).toHaveLength(1);
  expect(notices[0]).toContain(CLAUDE_COPY);
  expect(notices[0]).toContain("get_skill");
  expect(notices[0]).toContain("consent");
});

test("a current copy needs nothing", async () => {
  await write(AGENTS_COPY, "v2");
  await write(CLAUDE_COPY, "v2");

  const before = await t.run(Effect.flatMap(skillAfter("v1"), syncSkill));

  expect(skillNotices(before)).toEqual([]);
});

test("asks the agent to write a copy the sync could not", () => {
  expect(skillNotices([{ path: AGENTS_COPY, state: "missing" }])).toEqual([
    `${AGENTS_COPY} is missing. Call get_skill and write its markdown to that path.`,
  ]);
});
