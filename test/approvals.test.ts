import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Deferred, Effect, Fiber, FileSystem, Layer, Ref, Stream } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import type { AgentRequest, RunEvent } from "../src/core/agentParse.ts";
import type { RunInput } from "../src/core/agentRun.ts";
import { converse } from "../src/core/agentTurn.ts";
import type { Approval, ApprovalAnswer, Ask } from "../src/core/approval.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { type RunSpec, type Runner, makeRunRegistry } from "../src/core/runRegistry.ts";
import { it, testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const withFakes = testEffect(Layer.merge(tempWorkspace("Asks"), fakeAgents));

const root = "/work/space";

const SUGGESTION = {
  type: "addRules",
  rules: [{ toolName: "Bash", ruleContent: "ffmpeg:*" }],
  behavior: "allow",
  destination: "localSettings",
};

/** The fields of a control request these tests send, as Claude Code writes them. */
interface RequestFields {
  readonly subtype?: string;
  readonly tool_name?: string;
  readonly input?: Readonly<Record<string, string>>;
  readonly title?: string;
  readonly description?: string;
  readonly tool_use_id?: string;
  readonly permission_suggestions?: ReadonlyArray<typeof SUGGESTION>;
  readonly suppress_always_allow_rule?: boolean;
  readonly requires_user_interaction?: boolean;
}

/** Claude Code asking the board something, as `request`. */
const control = (id: string, request: RequestFields) =>
  JSON.stringify({ type: "control_request", request_id: id, request });

const canUse = (id: string, fields: RequestFields) =>
  control(id, { subtype: "can_use_tool", ...fields });

const ffmpeg = {
  tool_name: "Bash",
  input: { command: "ffmpeg -i clip.mp4 out.mp4" },
  description: "Cuts the clip",
  tool_use_id: "tu-1",
  permission_suggestions: [SUGGESTION],
};

const askOf = (line: string): AgentRequest => {
  const parsed = parseClaudeLine(line, root).control;

  if (parsed?.kind !== "ask") throw new Error(`not a request: ${line}`);

  return parsed.request;
};

describe("what Claude asks on stdout", () => {
  test("is a request to use a tool, with what the board shows of it", () => {
    const request = askOf(canUse("r1", ffmpeg));

    expect(request.approval).toEqual({
      id: "r1",
      tool: "Bash",
      kind: "command",
      network: false,
      title: undefined,
      detail: "ffmpeg -i clip.mp4 out.mp4",
      reason: "Cuts the clip",
      always: true,
      rules: ["Bash(ffmpeg:*)"],
      session: false,
    });
  });

  test("shows a file in the workspace by where it is in it", () => {
    const request = askOf(
      canUse("r1", {
        tool_name: "Write",
        input: { file_path: `${root}/items/a/story.yaml` },
        title: `Write ${root}/items/a/story.yaml`,
      }),
    );

    expect(request.approval.detail).toBe("items/a/story.yaml");
    expect(request.approval.title).toBe("Write items/a/story.yaml");
  });

  test("shows all of what the user would agree to, however long", () => {
    const command = `ffmpeg ${"-filter_complex [0:v]scale=1080:1920 ".repeat(20)}out.mp4`;
    const long = askOf(canUse("r1", { ...ffmpeg, input: { command } }));

    const feedback = askOf(
      canUse("r2", {
        tool_name: "mcp__cutfac__send_feedback_to_cutfac",
        input: { message: "The render button does nothing" },
      }),
    );

    expect(long.approval.detail).toBe(command);
    expect(JSON.parse(feedback.approval.detail ?? "")).toEqual({
      message: "The render button does nothing",
    });
  });

  test("offers Always allow only when Claude would keep a rule for it", () => {
    expect(askOf(canUse("r1", { ...ffmpeg, permission_suggestions: [] })).approval.always).toBe(
      false,
    );
    expect(
      askOf(canUse("r1", { ...ffmpeg, suppress_always_allow_rule: true })).approval.always,
    ).toBe(false);
  });

  test("can need the user at Claude itself, which is turned down at once", () => {
    const question = parseClaudeLine(
      canUse("r1", { tool_name: "ExitPlanMode", input: {}, requires_user_interaction: true }),
    ).control;

    if (question?.kind !== "reply") throw new Error("not answered at once");
    const [answer] = question.lines.map((line) => JSON.parse(line));

    expect(answer.response).toMatchObject({ subtype: "success", request_id: "r1" });
    expect(answer.response.response).toMatchObject({ behavior: "deny" });
    expect(answer.response.response.message).toContain("Cutfac board");
  });

  test("can be taken back, or be of a kind the board can't answer", () => {
    const cancel = JSON.stringify({ type: "control_cancel_request", request_id: "r1" });
    const elicitation = parseClaudeLine(control("r2", { subtype: "elicitation" })).control;

    expect(parseClaudeLine(cancel).control).toEqual({ kind: "cancel", id: "r1" });

    if (elicitation?.kind !== "reply") throw new Error("not answered at once");

    expect(elicitation.lines.map((line) => JSON.parse(line))).toEqual([
      {
        type: "control_response",
        response: { subtype: "error", request_id: "r2", error: expect.any(String) },
      },
    ]);
  });

  test("ends with the turn's result, after which Claude reads nothing more", () => {
    const result = { type: "result", subtype: "success", session_id: "s", result: "ok" };

    expect(parseClaudeLine(JSON.stringify(result)).ended).toBe(true);
  });
});

describe("the answer on stdin", () => {
  const request = askOf(canUse("r1", ffmpeg));
  const decoded = (answer: ApprovalAnswer) => JSON.parse(request.answer(answer));

  test("allows the tool as asked, this once", () => {
    expect(request.answer("allow")).toEndWith("\n");
    expect(decoded("allow")).toEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "r1",
        response: {
          behavior: "allow",
          updatedInput: ffmpeg.input,
          toolUseID: "tu-1",
          decisionClassification: "user_temporary",
        },
      },
    });
  });

  test("hands back the rule Claude offered, for Always allow", () => {
    expect(decoded("always").response.response).toMatchObject({
      behavior: "allow",
      updatedPermissions: [SUGGESTION],
      decisionClassification: "user_permanent",
    });
  });

  test("turns it down as Claude Code's own prompt would", () => {
    const { response } = decoded("deny").response;

    expect(response).toMatchObject({ behavior: "deny", decisionClassification: "user_reject" });
    expect(response.message).toContain("doesn't want to proceed");
  });
});

const turn = (bin: string, ask: Ask) =>
  converse({
    agent: "claude",
    stored: undefined,
    invocation: (args) =>
      Effect.succeed(agentInvocation("claude", { bin, prompt: "do it", ...args })),
    save: () => Effect.void,
    emit: () => Effect.void,
    ask,
  });

/** What the fake read back after its `n`th request. */
const readBack = (n: number) =>
  Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const fs = yield* FileSystem.FileSystem;

    return JSON.parse(yield* fs.readFileString(join(fakes.calls, String(n)))).response;
  });

describe("a Claude run that asks", () => {
  const session = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

  /** A fake Claude that asks `lines` in turn, then gives its result; `between` runs after each. */
  const asking = (lines: ReadonlyArray<string>, between: (n: number) => string) =>
    Effect.flatMap(FakeAgentDir, (fakes) =>
      fakes.bin(
        "claude",
        `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"${session}"}'
${lines.map((line, n) => `echo '${line}'\n${between(n)}`).join("\n")}
echo '{"type":"result","subtype":"success","session_id":"${session}","result":"ok"}'
`,
      ),
    );

  withFakes.live("gets each answer back on stdin as soon as it is given", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const asked = yield* Ref.make<ReadonlyArray<Approval>>([]);

      const bin = yield* asking(
        [
          canUse("q", { tool_name: "AskUserQuestion", input: {}, requires_user_interaction: true }),
          canUse("r1", ffmpeg),
          control("e", { subtype: "elicitation" }),
        ],
        (n) => `IFS= read -r answer; printf '%s\\n' "$answer" > "${fakes.calls}/${n}"`,
      );

      const result = yield* turn(bin, (approval) =>
        Effect.as(
          Ref.update(asked, (all) => [...all, approval]),
          "always",
        ),
      );

      expect(result).toMatchObject({ reply: "ok", failure: undefined });
      // Only the tool the board can answer is put to it.
      expect((yield* Ref.get(asked)).map((approval) => approval.id)).toEqual(["r1"]);

      const question = yield* readBack(0);

      expect(question.request_id).toBe("q");
      expect(question.response.behavior).toBe("deny");
      expect(question.response.message).toContain("Cutfac board");
      expect((yield* readBack(1)).response).toMatchObject({
        behavior: "allow",
        updatedPermissions: [SUGGESTION],
      });
      expect(yield* readBack(2)).toMatchObject({ subtype: "error", request_id: "e" });
    }),
  );

  withFakes.live("stops waiting on a request the agent takes back", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const fs = yield* FileSystem.FileSystem;
      const asked = join(fakes.dir, "asked");
      const interrupted = join(fakes.dir, "interrupted");
      const cancel = JSON.stringify({ type: "control_cancel_request", request_id: "r1" });

      // Claude ends the turn only once the wait is over, so a run that kept waiting is seen.
      const bin = yield* asking(
        [canUse("r1", ffmpeg)],
        () => `while [ ! -f "${asked}" ]; do sleep 0.02; done
echo '${cancel}'
for _ in $(seq 100); do [ -f "${interrupted}" ] && break; sleep 0.02; done
[ -f "${interrupted}" ] || exit 1`,
      );

      const result = yield* turn(bin, () =>
        fs.writeFileString(asked, "").pipe(
          Effect.orDie,
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.orDie(fs.writeFileString(interrupted, ""))),
        ),
      );

      expect(result.reply).toBe("ok");
      expect(yield* fs.exists(interrupted)).toBe(true);
    }),
  );
});

describe("the board's answer", () => {
  const input: RunInput = { itemId: "item", feedbackId: "f1", agent: "claude" };
  const approval: Approval = { id: "r1", tool: "Bash", detail: "ls", always: false, rules: [] };

  /** A run that asks once and reports the answer it got. */
  const runner: Runner<RunInput, never> = (run, emit, ask) =>
    Effect.gen(function* () {
      yield* emit({ type: "start", subject: run.feedbackId, agent: run.agent });
      const answer = yield* ask(approval);
      yield* emit({ type: "done", reply: JSON.stringify(answer) });
    });

  const spec: RunSpec<RunInput, never> = {
    key: (run) => run.itemId,
    subject: (run) => run.feedbackId,
    busy: "busy",
    runner,
  };

  /** Start the run, wait until it asks, then `act` on it; with the events up to the run's end. */
  const asked = <A>(
    act: (
      registry: Effect.Success<ReturnType<typeof makeRunRegistry<RunInput, never>>>,
    ) => Effect.Effect<A>,
  ) =>
    Effect.gen(function* () {
      const registry = yield* makeRunRegistry(spec);
      yield* registry.start(input);
      const subscription = yield* registry.subscribe("item");
      const seen = yield* Deferred.make<void>();

      const collecting = yield* Effect.forkChild(
        subscription.events.pipe(
          Stream.tap((event) =>
            event.type === "approval" ? Deferred.succeed(seen, undefined) : Effect.void,
          ),
          Stream.takeUntil((event) => event.type === "done" || event.type === "stopped"),
          Stream.runCollect,
        ),
      );

      yield* Deferred.await(seen);
      const acted = yield* act(registry);
      const events: ReadonlyArray<RunEvent> = yield* Fiber.join(collecting);
      const late = yield* registry.answer("item", "r1", "allow");

      return { acted, events, late };
    });

  it.effect("goes to the run that asked, once, and the request leaves the board", () =>
    Effect.gen(function* () {
      const result = yield* asked((registry) =>
        Effect.all([
          registry.answer("other", "r1", "allow"),
          registry.answer("item", "r2", "allow"),
          // Answers to questions don't answer a tool.
          registry.answer("item", "r1", { answers: { q: ["yes"] } }),
          registry.answer("item", "r1", "always"),
          registry.answer("item", "r1", "deny"),
        ]),
      );

      expect(result.acted).toEqual([false, false, false, true, false]);
      expect(result.events).toEqual([
        { type: "start", subject: "f1", agent: "claude" },
        { type: "approval", ...approval },
        { type: "approval-settled", id: "r1" },
        { type: "done", reply: '"always"' },
      ]);
      expect(result.late).toBe(false);
    }),
  );

  it.effect(
    "is counted on its item while it waits, which is named as it asks and is answered",
    () =>
      Effect.gen(function* () {
        const registry = yield* makeRunRegistry(spec);

        const named = yield* Effect.forkChild(
          registry.asks.pipe(Stream.take(2), Stream.runCollect),
          { startImmediately: true },
        );

        const subscription = yield* registry.subscribe("item");

        yield* registry.start(input);
        yield* subscription.events.pipe(
          Stream.takeUntil((event) => event.type === "approval"),
          Stream.runDrain,
        );

        const waiting = (yield* registry.pending("item")).length;
        yield* registry.answer("item", "r1", "allow");

        expect({
          waiting,
          named: yield* Fiber.join(named),
          after: (yield* registry.pending("item")).length,
        }).toEqual({ waiting: 1, named: ["item", "item"], after: 0 });
      }),
  );

  it.effect("is no longer waited on once the run is stopped", () =>
    Effect.gen(function* () {
      const result = yield* asked((registry) => registry.stop("item"));

      expect(result.acted).toBe(true);
      expect(result.events.map((event) => event.type)).toEqual([
        "start",
        "approval",
        "approval-settled",
        "stopped",
      ]);
      expect(result.late).toBe(false);
    }),
  );
});
