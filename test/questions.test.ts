import { describe, expect, test } from "bun:test";

import type { Schema } from "effect";

import type { AgentRequest } from "../src/core/agentParse.ts";
import { type Answer, answers } from "../src/core/approval.ts";
import { parseClaudeLine } from "../src/core/claudeStream.ts";
import { serverRequest } from "../src/core/codexApprovals.ts";

const asked = (control: ReturnType<typeof parseClaudeLine>["control"]): AgentRequest => {
  if (control?.kind !== "ask") throw new Error(`expected an ask, got ${control?.kind}`);

  return control.request;
};

/** `AskUserQuestion` as Claude Code asks for it. */
const claudeAsks = (input: Schema.JsonObject) =>
  JSON.stringify({
    type: "control_request",
    request_id: "r1",
    request: {
      subtype: "can_use_tool",
      tool_name: "AskUserQuestion",
      display_name: "AskUserQuestion",
      input,
      tool_use_id: "tu-1",
      requires_user_interaction: true,
    },
  });

const COLOR = {
  question: "Which color?",
  header: "Color",
  options: [{ label: "Red", description: "Warm" }, { label: "Blue" }],
  multiSelect: false,
};

const SIZES = { question: "Which sizes?", header: "", options: [], multiSelect: true };

describe("questions Claude asks with AskUserQuestion", () => {
  const request = asked(parseClaudeLine(claudeAsks({ questions: [COLOR, SIZES] })).control);
  const decoded = (answer: Answer) => JSON.parse(request.answer(answer)).response;

  test("go to the board, each under its text, and the user may write their own", () => {
    expect(request.approval).toEqual({
      id: "r1",
      tool: "AskUserQuestion",
      kind: "question",
      always: false,
      rules: [],
      questions: [
        {
          id: "Which color?",
          header: "Color",
          question: "Which color?",
          options: [{ label: "Red", description: "Warm" }, { label: "Blue" }],
          multiple: false,
          other: true,
        },
        { id: "Which sizes?", question: "Which sizes?", options: [], multiple: true, other: true },
      ],
    });
  });

  test("allow the tool with the answers in its input, several joined", () => {
    const answer = { answers: { "Which color?": ["Blue"], "Which sizes?": ["S", "M"] } };

    expect(decoded(answer)).toEqual({
      subtype: "success",
      request_id: "r1",
      response: {
        behavior: "allow",
        updatedInput: {
          questions: [COLOR, SIZES],
          answers: { "Which color?": "Blue", "Which sizes?": "S, M" },
        },
        toolUseID: "tu-1",
        decisionClassification: "user_temporary",
      },
    });
  });

  test("closed unanswered, turn the tool down so Claude goes on", () => {
    const { response } = decoded("deny");

    expect(response).toMatchObject({ behavior: "deny", toolUseID: "tu-1" });
    expect(response.message).toContain("without answering");
  });

  test("that can't be read are turned down at once, as the board can't answer them", () => {
    const control = parseClaudeLine(claudeAsks({ questions: [] })).control;

    expect(control?.kind).toBe("reply");
  });
});

const NO_CHANGES: ReadonlyMap<string, ReadonlyArray<string>> = new Map();

const codexAsks = (questions: Array<Schema.JsonObject>) =>
  serverRequest(
    9,
    "item/tool/requestUserInput",
    { threadId: "t", turnId: "u", itemId: "call", isBlocking: false, questions },
    NO_CHANGES,
    undefined,
  );

describe("questions Codex asks with request_user_input", () => {
  const request = asked(
    codexAsks([
      {
        id: "color",
        header: "Color",
        question: "Which color?",
        isOther: true,
        isSecret: false,
        options: [{ label: "Red", description: "Warm" }],
      },
      { id: "token", header: "", question: "Your token?", isSecret: true, options: null },
    ]),
  );

  const result = (answer: Answer) => {
    const reply = JSON.parse(request.answer(answer));

    expect(reply.id).toBe(9);

    return reply.result;
  };

  test("go to the board one pick each, written when Codex lets it or offers nothing", () => {
    expect(request.approval).toEqual({
      id: "9",
      tool: "request_user_input",
      kind: "question",
      always: false,
      rules: [],
      questions: [
        {
          id: "color",
          header: "Color",
          question: "Which color?",
          options: [{ label: "Red", description: "Warm" }],
          multiple: false,
          other: true,
          secret: false,
        },
        {
          id: "token",
          header: undefined,
          question: "Your token?",
          options: [],
          multiple: false,
          other: true,
          secret: true,
        },
      ],
    });
  });

  test("go back by question id, or none when closed unanswered", () => {
    expect(result({ answers: { color: ["Red"], token: ["abc"] } })).toEqual({
      answers: { color: { answers: ["Red"] }, token: { answers: ["abc"] } },
    });
    expect(result("deny")).toEqual({ answers: {} });
  });

  test("none at all are answered at once", () => {
    const control = codexAsks([]);

    if (control.kind !== "reply") throw new Error("not answered at once");

    expect(JSON.parse(control.lines[0] ?? "")).toEqual({ id: 9, result: { answers: {} } });
  });
});

describe("an answer", () => {
  const tool = { id: "r", tool: "Bash", always: false, rules: [] };
  const question = { ...tool, kind: "question" as const, questions: [] };

  test("to questions is answers, or a deny; to a tool, a choice", () => {
    expect(answers(question, { answers: {} })).toBe(true);
    expect(answers(question, "deny")).toBe(true);
    expect(answers(question, "allow")).toBe(false);
    expect(answers(tool, "always")).toBe(true);
    expect(answers(tool, { answers: {} })).toBe(false);
  });
});
