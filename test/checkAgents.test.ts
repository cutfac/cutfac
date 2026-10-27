import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, Option } from "effect";
import { TestConsole } from "effect/testing";

import {
  FIXTURE_ROOT,
  checkAgents,
  checkArgs,
  fixtureLines,
  readTurn,
  turnProblems,
  type TurnReading,
} from "../electron/checkAgents.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { codexTurn } from "../src/core/codexAppServer.ts";
import type { AgentName } from "../src/core/schema.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

describe("check:agents arguments", () => {
  test("checks every agent and saves fixtures, unless told otherwise", () => {
    expect(checkArgs([])).toEqual(Option.some({ agents: ["claude", "codex"], save: true }));
    expect(checkArgs(["codex"])).toEqual(Option.some({ agents: ["codex"], save: true }));
    expect(checkArgs(["--no-save", "claude", "claude"])).toEqual(
      Option.some({ agents: ["claude"], save: false }),
    );
  });

  it.effect.each([{ args: ["gemini"] }, { args: ["--save"] }])(
    "shows how to use it for $args, and fails",
    ({ args }) =>
      Effect.gen(function* () {
        expect(yield* checkAgents(args)).toBe(1);
        expect((yield* TestConsole.errorLines).join("\n")).toContain("Usage: bun run check:agents");
      }),
  );
});

describe("what a turn must show", () => {
  const read: TurnReading = {
    sessionId: "s1",
    reply: "ready-4721",
    error: undefined,
    tools: ["workspace_overview"],
  };

  const expected = { tool: true, reply: "ready-4721" };

  test("a turn with a session, the reply and a tool call has no problem", () => {
    expect(turnProblems(0, read, expected)).toEqual([]);
  });

  test("names each thing Cutfac could not read", () => {
    const unread: TurnReading = { sessionId: undefined, reply: "", error: undefined, tools: [] };

    expect(turnProblems(0, unread, expected)).toEqual([
      "gave no session id Cutfac could read",
      "gave no reply Cutfac could read",
      "made no tool call Cutfac could see",
    ]);
  });

  test("a resume turn needs no tool call, only to remember the first", () => {
    const resumed = { ...read, tools: [] };

    expect(turnProblems(0, resumed, { tool: false, reply: "ready" })).toEqual([]);
    expect(
      turnProblems(0, { ...resumed, reply: "no idea" }, { tool: false, reply: "4721" }),
    ).toEqual([`replied "no idea", without "4721"`]);
  });

  test("an error or a bad exit code is a problem even with a reply", () => {
    expect(turnProblems(1, { ...read, error: "boom" }, expected)).toEqual([
      "exited with code 1",
      "reported an error: boom",
    ]);
  });
});

describe("fixtures", () => {
  const systemLine = JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "s1",
    cwd: "/Users/someone/Videos/x",
    skills: ["private-skill"],
  });

  test("keep only what Cutfac reads of a line about the machine or the account", () => {
    const limit = JSON.stringify({ type: "rate_limit_event", rate_limit_info: { used: 0.4 } });

    expect(fixtureLines(`${systemLine}\n${limit}\n`, [])).toEqual([
      '{"type":"system","subtype":"init","session_id":"s1"}',
      '{"type":"rate_limit_event"}',
    ]);
  });

  test("swap the workspace and the home folder for stand-ins, the longer path first", () => {
    const line = JSON.stringify({
      type: "user",
      text: "/tmp/w/a.mp4 and /tmp/w-old/b.mp4 and /Users/me/.claude",
    });

    const [swapped] = fixtureLines(line, [
      ["/Users/me", "/home/user"],
      ["/tmp/w", FIXTURE_ROOT],
      ["/tmp/w-old", "/work/old"],
      ["", "never"],
    ]);

    expect(swapped).toBe(
      JSON.stringify({
        type: "user",
        text: `${FIXTURE_ROOT}/a.mp4 and /work/old/b.mp4 and /home/user/.claude`,
      }),
    );
  });

  test("keep of Codex only what it says about the conversation", () => {
    const done =
      '{"method":"turn/completed","params":{"threadId":"t","turn":{"id":"u","status":"completed"}}}';

    const asks = '{"id":0,"method":"item/permissions/requestApproval","params":{"threadId":"t"}}';

    const lines = [
      '{"id":1,"result":{"userAgent":"codex/0.164 (Mac OS 26)","codexHome":"/Users/me/.codex"}}',
      '{"method":"account/rateLimits/updated","params":{"rateLimits":{"primary":{"usedPercent":4}}}}',
      done,
      asks,
    ];

    expect(fixtureLines(lines.join("\n"), [])).toEqual([
      '{"id":1,"result":{}}',
      '{"method":"account/rateLimits/updated"}',
      done,
      asks,
    ]);
  });

  test("blank thinking signatures and request ids, and leave lines that are not JSON", () => {
    const thinking =
      '{"type":"assistant","content":[{"thinking":"","signature":"AbC+/="}],"request_id":"req_01x"}';

    expect(fixtureLines(`${thinking}\nwarning: not json\n\n`, [])).toEqual([
      '{"type":"assistant","content":[{"thinking":"","signature":""}],"request_id":""}',
      "warning: not json",
    ]);
  });

  test.each<AgentName>(["claude", "codex"])(
    "the captured %s turns pass the check they were saved by",
    async (agent) => {
      const lines = async (turn: string) =>
        (await readFile(join(import.meta.dir, "fixtures", `${agent}-${turn}.jsonl`), "utf8"))
          .split("\n")
          .filter((line) => line !== "");

      // A fresh reader for each turn, as each run has its own.
      const parser = () =>
        agent === "claude"
          ? parseClaudeLine
          : codexTurn({
              prompt: "",
              sessionId: undefined,
              images: [],
              model: undefined,
              effort: undefined,
              permissions: {},
            });

      const first = readTurn(parser(), await lines("first"), FIXTURE_ROOT);
      const resumed = readTurn(parser(), await lines("resume"), FIXTURE_ROOT);

      expect(turnProblems(0, first, { tool: true, reply: "ready-4721" })).toEqual([]);
      expect(first.tools).toContain(
        agent === "claude" ? "mcp__cutfac__workspace_overview" : "workspace_overview",
      );
      expect(turnProblems(0, resumed, { tool: false, reply: "4721" })).toEqual([]);
      expect(resumed.sessionId).toBe(first.sessionId);
    },
  );

  test("none keep the machine they were captured on", async () => {
    for (const name of ["claude-first", "claude-resume", "codex-first", "codex-resume"]) {
      const text = await readFile(join(import.meta.dir, "fixtures", `${name}.jsonl`), "utf8");

      expect(text).not.toContain("/Users/");
      expect(text).not.toContain("/private/");
      expect(text).not.toContain("cutfac-agent-check-");
    }
  });
});
