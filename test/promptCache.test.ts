import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Effect, type Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

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
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Prompt cache");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("keeps what the agent said last about its cache, for the next request to go by", async () => {
    await fakes.bin(
      "claude",
      `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"s1","per_turn_effort_active":true}'
echo '{"type":"system","subtype":"per_turn_effort_changed","per_turn_effort_active":false}'
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
    );

    const item = await t.runWith(
      fakes.layer,
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });
        const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });
        const input = { itemId: created.id, feedbackId: feedback.id, agent: "claude" as const };

        yield* runEdit(undefined)(input, () => Effect.void, refuse);

        return yield* getItem(created.id);
      }),
    );

    expect(item.doc.sessions.claude).toBe("s1");
    expect(item.doc.feedback[0]?.run).toMatchObject({ status: "done", effortKeepsCache: false });
  });
});
