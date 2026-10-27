import { expect } from "bun:test";
import { join } from "node:path";

import { Effect } from "effect";

import { movedRuleNotices } from "../src/core/claudeRules.ts";
import { readFormats } from "../src/core/library.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("Rules"));

const put = (rel: string, text: string) =>
  Effect.flatMap(Workspace, (ws) => ws.writeText(rel, text));

const notices = Effect.flatMap(readFormats(), ({ formats }) => movedRuleNotices(formats));

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

it.live("rules Cutfac listed for everyone have nothing to move", () =>
  Effect.gen(function* () {
    yield* put("cutfac.yaml", EARLIER_CONFIG);
    yield* put("formats/plain/format.yaml", "title: Plain\ntools: [Read, Bash(ffmpeg:*)]\n");

    expect(yield* notices).toEqual([]);
  }),
);

it.live("rules someone chose are named, with where they go now", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;

    yield* put("cutfac.yaml", `${EARLIER_CONFIG}    - Bash(uv:*)\n`);
    yield* put("formats/art/format.yaml", "title: Art\ntools: [Bash(ffmpeg:*), Bash(npx:*)]\n");

    const [config, format, ...rest] = yield* notices;
    const settings = join(ws.root, ".claude/settings.json");

    expect(rest).toEqual([]);
    expect(config).toStartWith("cutfac.yaml lists agent.claudeAllowedTools (Bash(uv:*)),");
    expect(config).toContain(`permissions.allow in ${settings}`);
    expect(format).toStartWith("formats/art/format.yaml lists tools (Bash(npx:*)),");
  }),
);

it.live("a workspace that lists none has none", () =>
  Effect.gen(function* () {
    yield* put("formats/plain/format.yaml", "title: Plain\n");

    expect(yield* notices).toEqual([]);
  }),
);
