import { describe, expect } from "bun:test";

import { Effect, Layer, Ref } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import type { RunEvent } from "../src/core/agentParse.ts";
import { converse } from "../src/core/agentTurn.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Signed out"), fakeAgents));

const SESSION = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

const EXPIRED = "Failed to authenticate: OAuth session expired and could not be refreshed";

/** A turn of a fake `claude` that prints `lines`, as Claude Code 2.1.311 does. */
const claudeTurn = (lines: ReadonlyArray<object>) =>
  Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const printed = lines.map((line) => `echo '${JSON.stringify(line)}'`).join("\n");
    const bin = yield* fakes.bin("claude", `head -n 1 >/dev/null\n${printed}\nexit 1\n`);
    const events = yield* Ref.make<ReadonlyArray<RunEvent>>([]);

    const result = yield* converse({
      agent: "claude",
      stored: undefined,
      invocation: (session) =>
        Effect.succeed(agentInvocation("claude", { bin, prompt: "hi", ...session })),
      save: () => Effect.void,
      emit: (event) => Ref.update(events, (all) => [...all, event]),
    });

    return { result, events: yield* Ref.get(events) };
  });

describe("a Claude turn turned down for want of a sign-in", () => {
  it.live("fails saying so, without Claude's own error line among the steps", () =>
    Effect.gen(function* () {
      const { result, events } = yield* claudeTurn([
        { type: "system", subtype: "init", session_id: SESSION },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: EXPIRED }] },
          session_id: SESSION,
          error: "authentication_failed",
        },
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: EXPIRED,
          session_id: SESSION,
        },
      ]);

      expect(result).toMatchObject({ failure: EXPIRED, signedOut: true });
      expect(events).toEqual([]);
    }),
  );

  it.live("a turn that fails for another reason doesn't ask for a sign-in", () =>
    Effect.gen(function* () {
      const { result } = yield* claudeTurn([
        { type: "system", subtype: "init", session_id: SESSION },
        {
          type: "assistant",
          message: { role: "assistant", content: [{ type: "text", text: "API Error: 500" }] },
          session_id: SESSION,
          error: "server_error",
        },
        {
          type: "result",
          subtype: "success",
          is_error: true,
          result: "API Error: 500",
          session_id: SESSION,
        },
      ]);

      expect(result.failure).toBe("API Error: 500");
      expect(result.signedOut).toBeUndefined();
    }),
  );
});
