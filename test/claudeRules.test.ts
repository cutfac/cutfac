import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { movedRuleNotices } from "../src/core/claudeRules.ts";
import { readFormats } from "../src/core/library.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

let t: TestWorkspace;

beforeEach(async () => {
  t = await makeWorkspace("Rules");
});

afterEach(() => t.remove());

const put = async (rel: string, text: string) => {
  await mkdir(join(t.root, rel, ".."), { recursive: true });
  await writeFile(join(t.root, rel), text);
};

const notices = () =>
  t.run(Effect.flatMap(readFormats(), ({ formats }) => movedRuleNotices(formats)));

/** cutfac.yaml as Cutfac wrote it, with the rules it listed for everyone. */
const EARLIER_CONFIG = `name: Rules
agent:
  default: claude
  claudeAllowedTools:
    - Read
    - Write
    - Edit
    - Glob
    - Grep
    - Bash(ffmpeg:*)
    - Bash(ffprobe:*)
    - Bash(bun:*)
    - Bash(npx:*)
    - Bash(ls:*)
    - Bash(mkdir:*)
    - Bash(cp:*)
    - Bash(mv:*)
`;

test("rules Cutfac listed for everyone have nothing to move", async () => {
  await put("cutfac.yaml", EARLIER_CONFIG);
  await put("formats/plain/format.yaml", "title: Plain\ntools: [Read, Bash(ffmpeg:*)]\n");

  expect(await notices()).toEqual([]);
});

test("rules someone chose are named, with where they go now", async () => {
  await put("cutfac.yaml", `${EARLIER_CONFIG}    - Bash(uv:*)\n`);
  await put("formats/art/format.yaml", "title: Art\ntools: [Bash(ffmpeg:*), Bash(npx:*)]\n");

  const [config, format, ...rest] = await notices();
  const settings = join(t.root, ".claude/settings.json");

  expect(rest).toEqual([]);
  expect(config).toStartWith("cutfac.yaml lists agent.claudeAllowedTools (Bash(uv:*)),");
  expect(config).toContain(`permissions.allow in ${settings}`);
  expect(format).toStartWith("formats/art/format.yaml lists tools (Bash(npx:*)),");
});

test("a workspace that lists none has none", async () => {
  await put("formats/plain/format.yaml", "title: Plain\n");

  expect(await notices()).toEqual([]);
});
