import { afterEach, beforeEach, describe, expect, test } from "bun:test";

// The end-to-end test runs the import registry against the test workspace.
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer, ManagedRuntime, type Schema, Stream } from "effect";

import { parseClaudeLine, type RunEvent } from "../src/core/agentParse.ts";
import { noteCompaction } from "../src/core/agentRun.ts";
import type { McpLaunch } from "../src/core/agents.ts";
import { ImportRuns, startImport } from "../src/core/importRun.ts";
import { getImport } from "../src/core/imports.ts";
import type { AgentRun, RunMessage } from "../web/src/api.ts";
import { NO_RUN, reduceRun, runView } from "../web/src/lib/run.ts";
import {
  type FakeAgents,
  type TestServices,
  makeFakeAgents,
  makeWorkspace,
  type TestWorkspace,
} from "./support.ts";

const COMPACTING = { type: "system", subtype: "status", status: "compacting" };

const BOUNDARY = {
  type: "system",
  subtype: "compact_boundary",
  compact_metadata: { trigger: "auto", pre_tokens: 160_000 },
};

/** The events a line of Claude Code's stream-json with `fields` makes. */
const claudeEvents = (fields: Schema.JsonObject) =>
  parseClaudeLine(JSON.stringify({ session_id: "s1", ...fields })).events;

const fold = (messages: ReadonlyArray<RunMessage>) => messages.reduce(reduceRun, NO_RUN);

describe("an agent compacting its conversation", () => {
  test("Claude Code's stream says when it starts, where it ends, and when it gives up", () => {
    const done = { type: "system", subtype: "status", status: null };

    expect(claudeEvents(COMPACTING)).toEqual([{ type: "compaction", state: "running" }]);
    expect(claudeEvents(BOUNDARY)).toEqual([{ type: "compaction", state: "done" }]);
    // The boundary already said it ended.
    expect(claudeEvents({ ...done, compact_result: "success" })).toEqual([]);
    expect(claudeEvents({ ...done, compact_result: "failed" })).toEqual([
      { type: "compaction", state: "failed" },
    ]);
    expect(claudeEvents({ type: "system", subtype: "init" })).toEqual([]);
  });

  test("the chat says so while it works, then marks where it happened", () => {
    const started: ReadonlyArray<RunMessage> = [
      { type: "start", subject: "f1", agent: "claude" },
      { type: "text", text: "Looking." },
      { type: "compaction", state: "running" },
    ];

    const looking = { kind: "text", text: "Looking." };

    expect(runView(undefined, fold(started), true)).toMatchObject({
      running: true,
      compacting: true,
      steps: [looking],
    });

    const compacted = fold([
      ...started,
      { type: "compaction", state: "done" },
      { type: "text", text: "Trimming." },
    ]);

    expect(runView(undefined, compacted, true)).toMatchObject({
      compacting: false,
      steps: [looking, { kind: "compaction" }, { kind: "text", text: "Trimming." }],
    });

    const gaveUp = fold([...started, { type: "compaction", state: "failed" }]);

    expect(runView(undefined, gaveUp, true)).toMatchObject({ compacting: false, steps: [looking] });
    // A stopped run is not compacting anymore, whatever it was doing.
    expect(runView(undefined, fold([...started, { type: "stopped" }]), true).compacting).toBe(
      false,
    );
  });

  test("a saved run keeps only that it compacted", () => {
    const saved: AgentRun = {
      agent: "claude",
      status: "done",
      startedAt: "2026-10-22T00:00:00.000Z",
      reply: "Done.",
    };

    expect(runView({ ...saved, compacted: true }, undefined, false)).toMatchObject({
      steps: [{ kind: "compaction" }],
      reply: "Done.",
    });
    expect(runView(saved, undefined, false).steps).toEqual([]);
  });

  test("a run remembers it compacted only once the agent got through it", async () => {
    const passed: Array<RunEvent> = [];

    const flags = await Effect.runPromise(
      Effect.gen(function* () {
        const { emit, compacted } = yield* noteCompaction((event) =>
          Effect.sync(() => passed.push(event)),
        );

        const seen: Array<boolean | undefined> = [];

        for (const state of ["running", "failed", "running", "done"] as const) {
          yield* emit({ type: "compaction", state });
          seen.push(yield* compacted);
        }

        return seen;
      }),
    );

    expect(flags).toEqual([undefined, undefined, undefined, true]);
    expect(passed.map((event) => event.type === "compaction" && event.state)).toEqual([
      "running",
      "failed",
      "running",
      "done",
    ]);
  });
});

describe("an import turn the agent compacted", () => {
  const SERVER: McpLaunch = { command: "cutfac", args: ["mcp", "--workspace", "/w"] };

  let t: TestWorkspace;
  let fakes: FakeAgents;
  let runtime: ManagedRuntime.ManagedRuntime<ImportRuns | TestServices, never>;

  beforeEach(async () => {
    t = await makeWorkspace("Compaction");
    fakes = await makeFakeAgents();

    runtime = ManagedRuntime.make(
      ImportRuns.layer.pipe(Layer.provideMerge(t.layer), Layer.provideMerge(fakes.layer)),
    );
  });

  afterEach(async () => {
    // Stops any agent still running before the workspace is removed.
    await runtime.dispose();
    await fakes.remove();
    await t.remove();
  });

  test("is recorded as compacted, for the chat to show once the stream is gone", async () => {
    await fakes.bin(
      "claude",
      `cat > /dev/null
echo '{"type":"system","subtype":"init","session_id":"sess-1"}'
echo '${JSON.stringify(COMPACTING)}'
echo '${JSON.stringify(BOUNDARY)}'
echo '{"type":"result","subtype":"success","session_id":"sess-1","result":"Done."}'
`,
    );

    const link = "https://example.com/pack";
    const started = await runtime.runPromise(startImport({ link, agent: "claude" }, SERVER));

    // The stream replays the run from its start, so nothing it said before this is missed.
    const events = await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const { events: stream } = yield* (yield* ImportRuns).subscribe(started.id);

          return yield* stream.pipe(
            Stream.takeUntil((event) => event.type === "done" || event.type === "error"),
            Stream.runCollect,
          );
        }),
      ),
    );

    expect(events.filter((event) => event.type === "compaction")).toEqual([
      { type: "compaction", state: "running" },
      { type: "compaction", state: "done" },
    ]);
    expect((await t.run(getImport(started.id))).doc.turns[0]?.run).toMatchObject({
      status: "done",
      compacted: true,
    });
  });
});
