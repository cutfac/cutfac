import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Effect, type Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import type {
  AgentChoice,
  AgentName,
  AgentRun,
  AgentStatus,
  Feedback,
  ItemDetail,
  ModelSettings,
} from "../web/src/api.ts";
import { cacheNotice } from "../web/src/lib/cache.ts";
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

const CLAUDE: AgentStatus = {
  agent: "claude",
  installed: true,
  connected: true,
  models: [
    { id: "opus", label: "Opus", efforts: ["low", "high"] },
    { id: "sonnet", label: "Sonnet", efforts: ["low", "high"] },
  ],
  efforts: ["low", "high"],
  defaultModel: "Opus",
};

const CODEX: AgentStatus = {
  agent: "codex",
  installed: true,
  connected: true,
  models: [
    { id: "gpt-a", label: "GPT-A", efforts: ["low", "high"], defaultEffort: "low" },
    {
      id: "gpt-b",
      label: "GPT-B",
      efforts: ["low", "high"],
      defaultEffort: "low",
      effortKeepsCache: false,
    },
  ],
  efforts: ["low", "high"],
};

const AT = "2026-10-22T00:00:00.000Z";

let requests = 0;

/** A request to an agent, with `extra` saying how it went. */
function request(extra: Partial<Feedback>): Feedback {
  requests += 1;

  return { id: `f${requests}`, at: AT, author: "user", body: "Trim it", status: "open", ...extra };
}

/** A request the agent ran as `run` says. */
const ran = (run: Partial<AgentRun> & Pick<AgentRun, "agent">) =>
  request({ run: { status: "done", startedAt: AT, ...run } });

function itemWith(
  feedback: Feedback[],
  sessions: Partial<Record<AgentName, string>> = { claude: "s1", codex: "t1" },
): ItemDetail {
  return {
    id: "item",
    dir: "items/item",
    running: false,
    media: [],
    docs: {},
    doc: { title: "Item", status: "drafting", sources: [], feedback, sessions },
    history: { cursor: 0, entries: [], versions: [], heads: {} },
    reviews: [],
    references: [],
    updatedAt: 0,
  };
}

const notice = (
  item: ItemDetail,
  status: AgentStatus,
  settings: ModelSettings = {},
  agent: AgentChoice = status.agent,
) => cacheNotice(item, agent, settings, status);

/** A conversation that last ran on Opus at low effort, with what the run said about its cache. */
const lowOnOpus = (said: Pick<AgentRun, "effortKeepsCache">) =>
  itemWith([ran({ agent: "claude", model: "opus", effort: "low", ...said })]);

describe("the notice that a pick makes the agent read the conversation again", () => {
  test("comes with another model, not with the one the conversation ran on", () => {
    const ranOnOpus = itemWith([ran({ agent: "claude", model: "opus" })]);

    expect(notice(ranOnOpus, CLAUDE, { model: "sonnet" })).toEqual({
      kind: "model",
      model: "sonnet",
    });
    expect(notice(ranOnOpus, CLAUDE, { model: "opus" })).toBeUndefined();
    // The default is Opus, which the conversation already runs on.
    expect(notice(ranOnOpus, CLAUDE)).toBeUndefined();
    expect(notice(itemWith([ran({ agent: "claude" })]), CLAUDE, { model: "sonnet" })).toEqual({
      kind: "model",
      model: "sonnet",
    });
  });

  test("goes by the agent's own last request, or the one lined up for it", () => {
    const item = itemWith([
      ran({ agent: "claude", model: "sonnet" }),
      ran({ agent: "codex", model: "gpt-a" }),
    ]);

    expect(notice(item, CLAUDE, { model: "sonnet" })).toBeUndefined();

    const waiting = request({ waiting: "claude", model: "opus" });

    expect(notice(itemWith([...item.doc.feedback, waiting]), CLAUDE)).toBeUndefined();
  });

  test("needs a conversation to lose, and an agent to send to", () => {
    const onOpus = [ran({ agent: "claude", model: "opus" })];
    const sonnet = { model: "sonnet" };

    expect(notice(itemWith(onOpus, {}), CLAUDE, sonnet)).toBeUndefined();
    expect(notice(itemWith([]), CLAUDE, sonnet)).toBeUndefined();
    expect(notice(itemWith(onOpus), CLAUDE, sonnet, "queue")).toBeUndefined();
  });

  test("comes with another effort only when the agent said that loses its cache", () => {
    const higher = { model: "opus", effort: "high" };

    expect(notice(lowOnOpus({ effortKeepsCache: false }), CLAUDE, higher)).toEqual({
      kind: "effort",
      effort: "high",
    });
    expect(notice(lowOnOpus({ effortKeepsCache: true }), CLAUDE, higher)).toBeUndefined();
    expect(notice(lowOnOpus({}), CLAUDE, higher)).toBeUndefined();
    expect(
      notice(lowOnOpus({ effortKeepsCache: false }), CLAUDE, { model: "opus", effort: "low" }),
    ).toBeUndefined();
  });

  test("takes what the model list says when the run did not, with the model's default effort", () => {
    const onB = itemWith([ran({ agent: "codex", model: "gpt-b" })]);
    const onA = itemWith([ran({ agent: "codex", model: "gpt-a", effort: "low" })]);

    expect(notice(onB, CODEX, { model: "gpt-b", effort: "high" })).toEqual({
      kind: "effort",
      effort: "high",
    });
    expect(notice(onB, CODEX, { model: "gpt-b", effort: "low" })).toBeUndefined();
    expect(notice(onA, CODEX, { model: "gpt-a", effort: "high" })).toBeUndefined();
  });

  test("stays quiet when the run named no model and the agent does not say its default", () => {
    const { defaultModel: _, ...unsaid } = CLAUDE;
    const ranOnDefault = itemWith([ran({ agent: "claude" })]);

    expect(notice(ranOnDefault, unsaid, { model: "sonnet" })).toBeUndefined();
    // Claude names a release of the alias it lists, which the conversation already ran on.
    expect(
      notice(ranOnDefault, { ...CLAUDE, defaultModel: "Opus 5.5" }, { model: "opus" }),
    ).toBeUndefined();
  });
});
