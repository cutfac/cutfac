import { describe, expect, test } from "bun:test";

import { Effect, Layer, type Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Prompt cache"), fakeAgents));

/** What a line of Claude Code's stream-json with `fields` says about keeping the cache. */
const keepsCache = (fields: Schema.JsonObject) =>
  parseClaudeLine(JSON.stringify(fields)).effortKeepsCache;

describe("whether a change of effort keeps the agent's cache", () => {
  test("Claude Code says so when it starts, and again when that turns false", () => {
    const init = { type: "system", subtype: "init", session_id: "s1" };

    expect(keepsCache({ ...init, per_turn_effort_active: true })).toBe(true);
    expect(keepsCache({ ...init, per_turn_effort_active: false })).toBe(false);
    expect(
      keepsCache({
        type: "system",
        subtype: "per_turn_effort_changed",
        per_turn_effort_active: false,
      }),
    ).toBe(false);
    // Older releases say nothing, which is not the same as no.
    expect(keepsCache(init)).toBeUndefined();
  });
});

describe("an edit run", () => {
  it.live("keeps what the agent said last about its cache, for the next request to go by", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin(
        "claude",
        `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"s1","per_turn_effort_active":true}'
echo '{"type":"system","subtype":"per_turn_effort_changed","per_turn_effort_active":false}'
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
      );

      const created = yield* createItem({ title: "Clip" });
      const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });
      const input = { itemId: created.id, feedbackId: feedback.id, agent: "claude" as const };

      yield* runEdit(undefined)(input, () => Effect.void, refuse);

      const item = yield* getItem(created.id);

      expect(item.doc.sessions.claude).toBe("s1");
      expect(item.doc.feedback[0]?.run).toMatchObject({ status: "done", effortKeepsCache: false });
    }),
  );
});
