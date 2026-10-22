import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { agentInvocation, isSessionId, isToolRule } from "../src/core/agentCommand.ts";
import { converse } from "../src/core/agentRun.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

describe("what an agent run lets through to the CLI", () => {
  test("a tool rule is one tool, with at most one specifier", () => {
    for (const rule of [
      "Read",
      "Bash(uv:*)",
      "Bash(npm run test:*)",
      "mcp__cutfac",
      "Edit(./**)",
      "WebFetch(domain:example.com)",
    ]) {
      expect(isToolRule(rule)).toBe(true);
    }

    for (const rule of ["a,b", "x),Bash,WebFetch(y", "Bash(a(b))", "Bash (ls)", "Read\n", ""]) {
      expect(isToolRule(rule)).toBe(false);
    }
  });

  test("a host that would add rules of its own is left out of the run's", () => {
    const { args } = agentInvocation("claude", {
      bin: "/bin/x",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
      allowedTools: ["Read", "Bash,WebFetch"],
      hosts: ["x),bash,webfetch(y.com", "ok.com"],
    });

    const allowed = args[args.indexOf("--allowedTools") + 1];

    expect(allowed).toBe("Read,WebFetch(domain:ok.com)");
    expect(args).toContain("--strict-mcp-config");
  });

  test("only an id an agent could have made counts as its session", () => {
    expect(isSessionId("cbbc5628-e7e7-4559-9e1a-db4263da3bc9")).toBe(true);
    expect(isSessionId("01a15cbb-ce4a-7520-952a-fe8655899d56")).toBe(true);
    expect(isSessionId("--dangerously-skip-permissions")).toBe(false);
    expect(isSessionId("s1")).toBe(false);
  });
});

describe("a stored session that is not one the agent made", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("never reaches the agent, and a new session takes its place", async () => {
    const fresh = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

    const bin = await fakes.bin(
      "claude",
      `cat >/dev/null
printf '%s\\n' "$@" > "${join(fakes.calls, "args")}"
echo '{"type":"system","subtype":"init","session_id":"${fresh}"}'
echo '{"type":"result","subtype":"success","session_id":"${fresh}","result":"ok"}'
`,
    );

    const saved: Array<string | undefined> = [];

    const result = await t.run(
      converse({
        agent: "claude",
        stored: "--dangerously-skip-permissions",
        invocation: (session) =>
          Effect.succeed(
            agentInvocation("claude", { bin, prompt: "hi", allowedTools: [], ...session }),
          ),
        save: (session) =>
          Effect.sync(() => {
            saved.push(session);
          }),
        emit: () => Effect.void,
      }),
    );

    const args = (await readFile(join(fakes.calls, "args"), "utf8")).split("\n");

    expect(result.reply).toBe("ok");
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(args).not.toContain("--resume");
    expect(args).toContain("--session-id");
    expect(saved).toEqual([fresh]);
  });
});
