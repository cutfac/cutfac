import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { buildEditPrompt, requestEdit } from "../src/core/edits.ts";
import { asksUser, createItem, mutateItem, updateFeedback } from "../src/core/items.ts";
import type { AgentRun, Feedback } from "../src/core/schema.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const done = (reply: string): AgentRun => ({
  agent: "claude",
  status: "done",
  startedAt: "2026-10-25T00:00:00Z",
  reply,
});

/** The agent's run on the request ended with this reply and left the request open. */
const endRun = (id: string, feedbackId: string, reply: string) =>
  mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => ({ ...entry, run: done(reply) })),
  );

describe("asksUser", () => {
  const open: Feedback = {
    id: "a",
    at: "2026-10-25T00:00:00Z",
    author: "you",
    body: "x",
    status: "open",
  };

  test("is a finished run whose request stays open with nothing to decide", () => {
    const run = done("Above or below?");

    expect(asksUser({ ...open, run })).toBe(true);
    expect(asksUser(open)).toBe(false);
    expect(asksUser({ ...open, run: { ...run, status: "failed" } })).toBe(false);
    expect(asksUser({ ...open, run, status: "resolved" })).toBe(false);
    expect(asksUser({ ...open, run, decision: "approved" })).toBe(false);
  });
});

describe("answering the agent's question", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("the next request settles the question and carries what the agent asked", async () => {
    const reply = "Should the caption sit above or below the face?";

    const { item, feedback, prompt } = await t.run(
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });
        const asked = yield* requestEdit(created.id, { body: "Add a caption" });

        yield* endRun(created.id, asked.feedback.id, reply);

        const answered = yield* requestEdit(created.id, { body: "Below" });

        return {
          ...answered,
          prompt: yield* buildEditPrompt(answered.item, answered.feedback),
        };
      }),
    );

    const question = item.doc.feedback[0];

    expect(question?.status).toBe("resolved");
    expect(question?.resolution).toBe("Answered in a later request");
    expect(feedback.answers).toBe(question?.id);
    expect(feedback.status).toBe("open");
    expect(prompt).toContain(`It answers what you asked on request ${question?.id}`);
    expect(prompt).toContain(`> ${reply}`);
  });

  test("a request with nothing asked before it answers nothing", async () => {
    const { item, feedback } = await t.run(
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });

        yield* requestEdit(created.id, { body: "First" });

        return yield* requestEdit(created.id, { body: "Second" });
      }),
    );

    expect(feedback.answers).toBeUndefined();
    expect(item.doc.feedback.map((entry) => entry.status)).toEqual(["open", "open"]);
  });
});
