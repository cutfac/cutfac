import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, Ref, type Schema } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import type { AgentControl, ParsedLine } from "../src/core/agentParse.ts";
import { converse } from "../src/core/agentTurn.ts";
import type { Approval, Ask } from "../src/core/approval.ts";
import { codexTurn } from "../src/core/codexAppServer.ts";
import type { CodexRun } from "../src/core/codexProtocol.ts";
import { testEffect } from "./effect.ts";
import {
  FAKE_THREAD,
  FakeAgentDir,
  type CodexReceived,
  codexAppServer,
  codexItem,
  codexReceived,
  fakeAgents,
  tempWorkspace,
} from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Codex asks"), fakeAgents));

const RUN: CodexRun = {
  prompt: "Trim the intro.",
  sessionId: undefined,
  images: [],
  model: undefined,
  effort: undefined,
  permissions: { sandbox: "workspace-write" },
};

const THREAD = "thread-1";

const TURN = "turn-1";

const send = (message: Schema.JsonObject) => JSON.stringify(message);

/** The messages a control sends back to Codex, parsed. */
function sent(control: AgentControl | undefined): ReadonlyArray<CodexReceived> {
  if (control?.kind !== "reply") throw new Error(`expected a reply, got ${control?.kind}`);

  return control.lines.map((line) => JSON.parse(line));
}

const notify = (method: string, params: Schema.JsonObject) => send({ method, params });

const item = (phase: "started" | "completed", body: Schema.JsonObject, threadId = THREAD) =>
  notify(`item/${phase}`, { threadId, turnId: TURN, item: body });

const completed = (status: string, extra: Schema.JsonObject = {}, id = TURN) =>
  notify("turn/completed", { threadId: THREAD, turn: { id, status, ...extra } });

/** A reader past the handshake: the thread started and the turn under way. */
function started(run: Partial<CodexRun> = {}) {
  const read = codexTurn({ ...RUN, ...run });

  read(send({ id: 1, result: {} }), undefined);
  read(send({ id: 2, result: { thread: { id: THREAD } } }), undefined);
  read(send({ id: 3, result: { turn: { id: TURN, status: "inProgress" } } }), undefined);

  return (line: string, root?: string): ParsedLine => read(line, root);
}

describe("a Codex turn's connection", () => {
  test("answers initialize with initialized and a new thread with the run's permissions", () => {
    const read = codexTurn({ ...RUN, model: "gpt-5.5" });

    expect(sent(read(send({ id: 1, result: { userAgent: "codex" } }), undefined).control)).toEqual([
      { method: "initialized" },
      {
        id: 2,
        method: "thread/start",
        params: { sandbox: "workspace-write", model: "gpt-5.5" },
      },
    ]);
  });

  test("resumes the item's thread without loading its turns", () => {
    const [, thread] = sent(
      codexTurn({ ...RUN, sessionId: THREAD })(send({ id: 1, result: {} }), undefined).control,
    );

    expect(thread).toEqual({
      id: 2,
      method: "thread/resume",
      params: { sandbox: "workspace-write", threadId: THREAD, excludeTurns: true },
    });
  });

  test("starts the turn on the thread, with the prompt, the pictures and the effort", () => {
    const read = codexTurn({ ...RUN, images: ["/w/frame.png"], effort: "high" });

    read(send({ id: 1, result: {} }), undefined);
    const thread = read(send({ id: 2, result: { thread: { id: THREAD } } }), undefined);

    expect(thread.sessionId).toBe(THREAD);
    expect(sent(thread.control)).toEqual([
      {
        id: 3,
        method: "turn/start",
        params: {
          threadId: THREAD,
          input: [
            { type: "text", text: "Trim the intro.", text_elements: [] },
            { type: "localImage", path: "/w/frame.png" },
          ],
          effort: "high",
        },
      },
    ]);
  });

  test("fails when Codex refuses a request or starts no thread", () => {
    const read = codexTurn(RUN);

    expect(read(send({ id: 1, error: { code: -1, message: "no auth" } }), undefined)).toEqual({
      events: [],
      error: "no auth",
      ended: true,
    });

    const unthreaded = codexTurn(RUN);

    unthreaded(send({ id: 1, result: {} }), undefined);

    expect(unthreaded(send({ id: 2, result: {} }), undefined).error).toBe(
      "Codex started no thread",
    );
  });

  test("reads nothing from noise, or from what other threads say", () => {
    const read = started();

    expect(read("Reading prompt from stdin…")).toEqual({ events: [] });
    expect(read(notify("account/updated", {}))).toEqual({ events: [] });
    expect(read(item("completed", { type: "agentMessage", text: "Sub." }, "thread-2"))).toEqual({
      events: [],
    });
  });
});

describe("a Codex turn's items", () => {
  test("shows commands, edits and tool calls as they start, relative to the workspace", () => {
    const read = started();
    const root = "/Users/me/brew";

    expect(
      read(item("started", { type: "commandExecution", command: `ls ${root}/a` }), root),
    ).toEqual({ events: [{ type: "tool", name: "shell", detail: "ls a" }] });
    expect(
      read(
        item("started", {
          type: "fileChange",
          id: "c1",
          changes: [{ path: `${root}/items/a/story.yaml` }],
        }),
        root,
      ).events,
    ).toEqual([{ type: "tool", name: "edit", detail: "items/a/story.yaml" }]);
    expect(
      read(
        item("started", {
          type: "mcpToolCall",
          tool: "render_item",
          arguments: { path: `${root}/items/a` },
        }),
        root,
      ).events,
    ).toEqual([{ type: "tool", name: "render_item", detail: "items/a" }]);
  });

  test("keeps what Codex says as the reply, and shows its searches and compaction", () => {
    const read = started();

    expect(read(item("completed", { type: "agentMessage", text: "Cut it." }))).toEqual({
      events: [{ type: "text", text: "Cut it." }],
      reply: "Cut it.",
    });
    expect(read(item("completed", { type: "agentMessage", text: "  " }))).toEqual({ events: [] });
    expect(read(item("completed", { type: "webSearch", query: "brew" })).events).toEqual([
      { type: "tool", name: "WebSearch", detail: "brew" },
    ]);
    expect(read(item("started", { type: "contextCompaction" })).events).toEqual([
      { type: "compaction", state: "running" },
    ]);
    expect(read(item("completed", { type: "contextCompaction" })).events).toEqual([
      { type: "compaction", state: "done" },
    ]);
  });
});

/** An error Codex reports on the run's turn. */
const error = (message: string, willRetry: boolean) =>
  notify("error", { threadId: THREAD, turnId: TURN, willRetry, error: { message } });

describe("a Codex turn's end", () => {
  test("ends when its own turn completes", () => {
    const read = started();

    expect(read(completed("completed", {}, "turn-0"))).toEqual({ events: [] });
    expect(read(completed("completed"))).toEqual({ events: [], ended: true });
  });

  test("fails with the turn's error, or else the last one Codex gave up on", () => {
    const read = started();

    expect(read(error("retrying", true))).toEqual({ events: [] });
    expect(read(error("usage limit", false))).toEqual({ events: [] });
    expect(read(completed("failed"))).toEqual({ events: [], error: "usage limit", ended: true });

    expect(started()(completed("failed", { error: { message: "boom" } })).error).toBe("boom");
    expect(started()(completed("interrupted")).error).toBe("Codex failed");
  });

  test("passes over an error of another turn", () => {
    const read = started();

    read(notify("error", { threadId: THREAD, turnId: "turn-0", willRetry: false, error: {} }));

    expect(read(completed("failed")).error).toBe("Codex failed");
  });
});

describe("what a Codex turn asks", () => {
  test("puts a request to the board, and withdraws it once Codex resolves it", () => {
    const read = started();

    const asked = read(
      send({
        id: 7,
        method: "item/commandExecution/requestApproval",
        params: { threadId: THREAD, command: "curl example.com" },
      }),
    );

    expect(asked.control?.kind).toBe("ask");
    expect(read(notify("serverRequest/resolved", { threadId: THREAD, requestId: 7 }))).toEqual({
      events: [],
      control: { kind: "cancel", id: "7" },
    });
  });

  test("puts what a subagent asks to the board too", () => {
    const read = started();

    const asked = read(
      send({
        id: 8,
        method: "item/fileChange/requestApproval",
        params: { threadId: "thread-2", itemId: "c9" },
      }),
    );

    expect(asked.control?.kind).toBe("ask");
  });

  test("refuses a request the board doesn't answer, so Codex goes on", () => {
    const [refusal] = sent(
      started()(send({ id: "u1", method: "item/tool/call", params: {} })).control,
    );

    expect(refusal).toMatchObject({ id: "u1", error: { code: -32601 } });
  });
});

/** A line of a fake's script that asks, as `codex app-server` asks on its thread. */
const request = (id: number, method: string, params: Schema.JsonObject) =>
  `echo '${send({ id, method, params: { threadId: FAKE_THREAD, turnId: "turn-1", ...params } })}'`;

const answer = (id: number) =>
  Effect.flatMap(FakeAgentDir, ({ calls }) =>
    Effect.map(codexReceived(calls), (received) =>
      received.find((message) => message["id"] === id),
    ),
  );

describe("a Codex run that asks", () => {
  const turn = Effect.fnUntraced(function* (turnScript: string, ask: Ask) {
    const fakes = yield* FakeAgentDir;
    const saved = yield* Ref.make<ReadonlyArray<string | undefined>>([]);
    const bin = yield* fakes.bin("codex", codexAppServer(fakes.calls, turnScript));

    const result = yield* converse({
      agent: "codex",
      stored: undefined,
      invocation: (args) =>
        Effect.succeed(agentInvocation("codex", { bin, prompt: "do it", ...args })),
      save: (sessionId) => Ref.update(saved, (all) => [...all, sessionId]),
      emit: () => Effect.void,
      ask,
    });

    return { result, saved: yield* Ref.get(saved) };
  });

  it.live("gets the board's answer back as soon as it is given, and goes on", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const asked = yield* Ref.make<ReadonlyArray<Approval>>([]);
      const readAnswer = `IFS= read -r answer; printf '%s\\n' "$answer" >> "${fakes.calls}/stdin"`;

      const { result, saved } = yield* turn(
        [
          request(7, "item/commandExecution/requestApproval", {
            command: "ffmpeg -i a.mp4 b.mp4",
            proposedExecpolicyAmendment: ["ffmpeg"],
          }),
          readAnswer,
          request(8, "mcpServer/elicitation/request", {
            serverName: "x",
            mode: "form",
            message: "Your email?",
            _meta: null,
          }),
          readAnswer,
          codexItem({ type: "agentMessage", id: "m1", text: "Cut." }),
        ].join("\n"),
        (approval) =>
          Effect.as(
            Ref.update(asked, (all) => [...all, approval]),
            "always",
          ),
      );

      expect(result).toMatchObject({ reply: "Cut.", failure: undefined });
      expect(saved).toEqual([FAKE_THREAD]);
      expect((yield* Ref.get(asked)).map((approval) => approval.id)).toEqual(["7"]);
      expect(yield* answer(7)).toEqual({
        id: 7,
        result: {
          decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ["ffmpeg"] } },
        },
      });
      expect(yield* answer(8)).toEqual({
        id: 8,
        result: { action: "cancel", content: null, _meta: null },
      });
    }),
  );

  it.live("stops waiting on a request Codex resolves on its own", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const fs = yield* FileSystem.FileSystem;
      const asked = join(fakes.dir, "asked");
      const interrupted = join(fakes.dir, "interrupted");

      const { result } = yield* turn(
        [
          request(7, "item/fileChange/requestApproval", { itemId: "c1" }),
          `while [ ! -f "${asked}" ]; do sleep 0.02; done`,
          `echo '${notify("serverRequest/resolved", { threadId: FAKE_THREAD, requestId: 7 })}'`,
          `for _ in $(seq 100); do [ -f "${interrupted}" ] && break; sleep 0.02; done`,
          `if [ -f "${interrupted}" ]; then ${codexItem({ type: "agentMessage", id: "m1", text: "Done." })}`,
          `else ${codexItem({ type: "agentMessage", id: "m1", text: "Still waiting." })}; fi`,
        ].join("\n"),
        () =>
          fs.writeFileString(asked, "").pipe(
            Effect.orDie,
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Effect.orDie(fs.writeFileString(interrupted, ""))),
          ),
      );

      expect(result.reply).toBe("Done.");
      expect(yield* fs.exists(interrupted)).toBe(true);
      expect(yield* answer(7)).toBeUndefined();
    }),
  );
});
