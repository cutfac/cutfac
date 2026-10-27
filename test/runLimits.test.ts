import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, Ref } from "effect";

import { agentInvocation, isSessionId } from "../src/core/agentCommand.ts";
import { converse } from "../src/core/agentTurn.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Test"), fakeAgents));

describe("what an agent run lets through to the CLI", () => {
  test("claude allows only Cutfac's own tools, and asks on stdin about the rest", () => {
    const { args, stdin, attended } = agentInvocation("claude", {
      bin: "/bin/x",
      prompt: "do it",
      sessionId: undefined,
      newSessionId: "new",
      hosts: ["x),bash,webfetch(y.com", "ok.com"],
    });

    const allowed = args[args.indexOf("--allowedTools") + 1]?.split(",") ?? [];

    expect(allowed.length).toBeGreaterThan(0);

    for (const tool of allowed) expect(tool).toStartWith("mcp__cutfac__");
    expect(args).toContain("--strict-mcp-config");
    expect(args[args.indexOf("--permission-prompt-tool") + 1]).toBe("stdio");
    expect(args[args.indexOf("--input-format") + 1]).toBe("stream-json");
    expect(attended).toBe(true);
    expect(JSON.parse(stdin)).toEqual({
      type: "user",
      message: { role: "user", content: "do it" },
    });
  });

  test("only an id an agent could have made counts as its session", () => {
    expect(isSessionId("cbbc5628-e7e7-4559-9e1a-db4263da3bc9")).toBe(true);
    expect(isSessionId("01a15cbb-ce4a-7520-952a-fe8655899d56")).toBe(true);
    expect(isSessionId("--dangerously-skip-permissions")).toBe(false);
    expect(isSessionId("s1")).toBe(false);
  });
});

describe("a stored session that is not one the agent made", () => {
  it.live("never reaches the agent, and a new session takes its place", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fakes = yield* FakeAgentDir;
      const fresh = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

      const bin = yield* fakes.bin(
        "claude",
        `head -n 1 >/dev/null
printf '%s\\n' "$@" > "${join(fakes.calls, "args")}"
echo '{"type":"system","subtype":"init","session_id":"${fresh}"}'
echo '{"type":"result","subtype":"success","session_id":"${fresh}","result":"ok"}'
`,
      );

      const saved = yield* Ref.make<ReadonlyArray<string | undefined>>([]);

      const result = yield* converse({
        agent: "claude",
        stored: "--dangerously-skip-permissions",
        invocation: (session) =>
          Effect.succeed(agentInvocation("claude", { bin, prompt: "hi", ...session })),
        save: (session) => Ref.update(saved, (sessions) => [...sessions, session]),
        emit: () => Effect.void,
      });

      const args = (yield* fs.readFileString(join(fakes.calls, "args"))).split("\n");

      expect(result.reply).toBe("ok");
      expect(args).not.toContain("--dangerously-skip-permissions");
      expect(args).not.toContain("--resume");
      expect(args).toContain("--session-id");
      expect(yield* Ref.get(saved)).toEqual([fresh]);
    }),
  );
});
