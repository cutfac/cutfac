import { describe, expect } from "bun:test";

import { Effect, Layer } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Failed in a row"), fakeAgents));

const FAILS = `head -n 1 >/dev/null
echo '{"type":"result","subtype":"success","is_error":true,"session_id":"s1","result":"API Error: 500"}'
exit 1
`;

const WORKS = `head -n 1 >/dev/null
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`;

describe("runs that keep failing", () => {
  it.live("count up across retries and new requests, and start over once one works", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const created = yield* createItem({ title: "Clip" });
      const { feedback: first } = yield* addFeedback(created.id, { body: "Trim it" });
      const { feedback: second } = yield* addFeedback(created.id, { body: "Trim it more" });

      const run = (feedbackId: string, script: string) =>
        Effect.gen(function* () {
          yield* fakes.bin("claude", script);
          yield* runEdit(undefined)(
            { itemId: created.id, feedbackId, agent: "claude" },
            () => Effect.void,
            refuse,
          );

          const item = yield* getItem(created.id);

          return item.doc.feedback.find((entry) => entry.id === feedbackId)?.run;
        });

      expect(yield* run(first.id, FAILS)).toMatchObject({ status: "failed", failedInARow: 1 });
      // A retry replaces the run it retries, and still counts it.
      expect(yield* run(first.id, FAILS)).toMatchObject({ status: "failed", failedInARow: 2 });
      expect(yield* run(second.id, FAILS)).toMatchObject({ status: "failed", failedInARow: 3 });

      expect((yield* run(first.id, WORKS))?.failedInARow).toBeUndefined();
      expect(yield* run(second.id, FAILS)).toMatchObject({ status: "failed", failedInARow: 1 });
    }),
  );
});
