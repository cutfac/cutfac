import { Option, Schema } from "effect";

import {
  type AgentControl,
  NOTHING,
  type ParsedLine,
  type RunEvent,
  UNSUPPORTED,
  decodeList,
  decodeObject,
  jsonLine,
  mainArgument,
  shownText,
  textOf,
  toolDetail,
} from "./agentParse.ts";
import {
  type Answer,
  type Approval,
  type ApprovalAnswer,
  type ApprovalKind,
  type Question,
  QuestionOption,
  answersGiven,
  choiceOf,
} from "./approval.ts";

const ClaudeEnvelope = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
  /** On a `result` line that ended in an error without a result: what went wrong. */
  errors: Schema.optional(Schema.Array(Schema.String)),
  /** On an `assistant` line Claude Code wrote itself: why the request failed. */
  error: Schema.optional(Schema.String),
  /** On a `system` `status` line: what Claude Code is busy with, or null once it is not. */
  status: Schema.optional(Schema.NullOr(Schema.String)),
  compact_result: Schema.optional(Schema.String),
  /**
   * On `init`, and on a `per_turn_effort_changed` line when it turns false: whether the effort goes
   * inside the conversation, so changing it keeps the prompt cache, or only with each request.
   */
  per_turn_effort_active: Schema.optional(Schema.Boolean),
});

type ClaudeEnvelope = typeof ClaudeEnvelope.Type;

const decodeClaudeEnvelope = Schema.decodeUnknownOption(ClaudeEnvelope);

const ClaudeBlock = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
  input: Schema.optional(Schema.JsonObject),
});

const decodeClaudeMessage = Schema.decodeUnknownOption(
  Schema.Struct({ content: Schema.Array(ClaudeBlock) }),
);

const claudeEvents = (json: Schema.JsonObject, root: string | undefined): ReadonlyArray<RunEvent> =>
  Option.match(decodeClaudeMessage(json["message"]), {
    onNone: () => [],
    onSome: (message) =>
      message.content.flatMap((block): ReadonlyArray<RunEvent> => {
        if (block.type === "text" && block.text !== undefined && block.text.trim() !== "") {
          return [{ type: "text", text: block.text }];
        }

        if (block.type === "tool_use" && block.name !== undefined) {
          const detail = Option.flatMap(Option.fromUndefinedOr(block.input), (input) =>
            toolDetail(input, root),
          );

          return [{ type: "tool", name: block.name, detail: Option.getOrUndefined(detail) }];
        }

        return [];
      }),
  });

/**
 * Claude Code compacting the conversation on its own, as it does when the context fills up: a
 * `compacting` status while it works, then a boundary where the summary starts, or a failed result.
 */
function claudeCompaction(msg: ClaudeEnvelope): ReadonlyArray<RunEvent> {
  if (msg.type !== "system") return [];

  if (msg.subtype === "compact_boundary") return [{ type: "compaction", state: "done" }];

  if (msg.subtype !== "status") return [];

  if (msg.status === "compacting") return [{ type: "compaction", state: "running" }];

  return msg.compact_result === "failed" ? [{ type: "compaction", state: "failed" }] : [];
}

/** Claude's answer to a request, as `--permission-prompt-tool stdio` reads it. */
type Decision =
  | {
      readonly behavior: "allow";
      readonly updatedInput: Schema.JsonObject;
      readonly updatedPermissions?: ReadonlyArray<Schema.Json>;
      readonly toolUseID: string | undefined;
      readonly decisionClassification: "user_temporary" | "user_permanent";
    }
  | {
      readonly behavior: "deny";
      readonly message: string;
      readonly toolUseID: string | undefined;
      readonly decisionClassification: "user_reject";
    };

/** A line of Claude's stream-json input: the user's message, or the answer to a request. */
type ClaudeInput =
  | { readonly type: "user"; readonly message: { readonly role: "user"; readonly content: string } }
  | {
      readonly type: "control_response";
      readonly response:
        | { readonly subtype: "success"; readonly request_id: string; readonly response: Decision }
        | { readonly subtype: "error"; readonly request_id: string; readonly error: string };
    };

const claudeLine = (input: ClaudeInput) => `${JSON.stringify(input)}\n`;

/** The user's message `prompt`, as Claude reads it from stream-json. */
export const claudeMessage = (prompt: string) =>
  claudeLine({ type: "user", message: { role: "user", content: prompt } });

/** What Claude Code itself tells the model when the user turns a tool down. */
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was " +
  "a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for " +
  "the user to tell you how to proceed.";

/** What the agent hears when a tool it asks for needs the user at the agent itself. */
const IN_PERSON =
  "The user is following this run on the Cutfac board, which can't answer this tool. Go on " +
  "without it, and say in your reply what you needed from the user.";

/** What the agent hears when the user closes its questions without answering them. */
const UNANSWERED =
  "The user closed your questions without answering them. Go on without the answers if you " +
  "can; otherwise ask again in your reply.";

/** What an answer to a `can_use_tool` request has to carry back. */
interface ToolUse {
  readonly id: string;
  readonly input: Schema.JsonObject;
  /** The rules Claude Code would add to stop asking, which an Always allow hands back. */
  readonly suggestions: ReadonlyArray<Schema.Json>;
  readonly toolUseId: string | undefined;
}

function claudeDecision(use: ToolUse, answer: ApprovalAnswer, message: string): Decision {
  const toolUseID = use.toolUseId;

  if (answer === "deny") {
    return { behavior: "deny", message, toolUseID, decisionClassification: "user_reject" };
  }

  const once = { behavior: "allow", updatedInput: use.input, toolUseID } as const;

  if (answer === "allow") return { ...once, decisionClassification: "user_temporary" };

  return { ...once, updatedPermissions: use.suggestions, decisionClassification: "user_permanent" };
}

/**
 * The answer to `use`, as Claude Code's own prompt would give it: the input as asked, and for
 * Always allow the rules it offered, which it then keeps where it said.
 */
const claudeAnswer = (use: ToolUse, answer: ApprovalAnswer, message = REJECTED) =>
  claudeLine({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: use.id,
      response: claudeDecision(use, answer, message),
    },
  });

/** Claude Code's own tool for asking the user questions, which the board answers in its stead. */
const ASK_TOOL = "AskUserQuestion";

const AskInput = Schema.Struct({
  questions: Schema.Array(
    Schema.Struct({
      question: Schema.String,
      header: Schema.optional(Schema.String),
      options: Schema.optional(Schema.Array(QuestionOption)),
      multiSelect: Schema.optional(Schema.Boolean),
    }),
  ),
});

const decodeAskInput = Schema.decodeUnknownOption(AskInput);

/**
 * `AskUserQuestion`'s questions put to the board. Claude Code takes the answers in the tool's
 * input, keyed by the question's text, several picked ones joined as its own prompt joins them,
 * and always lets the user write an answer of their own. None of its questions, or a tool input
 * it can't read, leaves it to the deny for a tool the board can't stand in for.
 */
function questionRequest(use: ToolUse): Option.Option<AgentControl> {
  const asked = Option.getOrUndefined(decodeAskInput(use.input))?.questions ?? [];

  if (asked.length === 0) return Option.none();

  const questions = asked.map((question): Question => ({
    id: question.question,
    header: question.header === "" ? undefined : question.header,
    question: question.question,
    options: question.options ?? [],
    multiple: question.multiSelect === true,
    other: true,
  }));

  const approval: Approval = {
    id: use.id,
    tool: ASK_TOOL,
    kind: "question",
    always: false,
    rules: [],
    questions,
  };

  const answer = (given: Answer) => {
    const picked = answersGiven(given);

    if (picked === undefined) return claudeAnswer(use, "deny", UNANSWERED);

    const answers = Object.fromEntries(
      Object.entries(picked).map(([question, values]) => [question, values.join(", ")]),
    );

    return claudeAnswer({ ...use, input: { ...use.input, answers } }, "allow");
  };

  return Option.some({ kind: "ask", request: { approval, answer } });
}

/** The answer to a request of a kind the board doesn't take, so Claude goes on without it. */
const claudeRefusal = (id: string, error: string) =>
  claudeLine({ type: "control_response", response: { subtype: "error", request_id: id, error } });

/** A change to its permissions that Claude Code offers to make if the user allows always. */
const Suggestion = Schema.Struct({
  type: Schema.String,
  behavior: Schema.optional(Schema.String),
  /** Where Claude Code keeps it: `session` for this conversation, or one of its settings files. */
  destination: Schema.optional(Schema.String),
  rules: Schema.optional(
    Schema.Array(
      Schema.Struct({ toolName: Schema.String, ruleContent: Schema.optional(Schema.String) }),
    ),
  ),
});

const decodeSuggestion = Schema.decodeUnknownOption(Suggestion);

const ADDS_RULES = new Set(["addRules", "replaceRules"]);

/** Whether every one of `suggestions` lasts only for this conversation. */
const forSession = (suggestions: ReadonlyArray<Schema.Json>) =>
  suggestions.length > 0 &&
  suggestions.every((json) =>
    Option.match(decodeSuggestion(json), {
      onNone: () => false,
      onSome: (suggestion) => suggestion.destination === "session",
    }),
  );

/** What each of Claude Code's own tools is for; any other, such as an MCP tool, is a tool. */
const KINDS: ReadonlyMap<string, ApprovalKind> = new Map([
  ["Bash", "command"],
  ["Edit", "edit"],
  ["MultiEdit", "edit"],
  ["Write", "edit"],
  ["NotebookEdit", "edit"],
  ["WebFetch", "network"],
  ["WebSearch", "network"],
]);

/** The allow rules `suggestions` would keep, written as Claude Code writes them in its settings. */
const allowRules = (suggestions: ReadonlyArray<Schema.Json>) =>
  suggestions.flatMap((json) =>
    Option.match(decodeSuggestion(json), {
      onNone: () => [],
      onSome: (suggestion) =>
        ADDS_RULES.has(suggestion.type) && suggestion.behavior === "allow"
          ? (suggestion.rules ?? []).map(({ toolName, ruleContent }) =>
              ruleContent === undefined ? toolName : `${toolName}(${ruleContent})`,
            )
          : [],
    }),
  );

/**
 * A `can_use_tool` request, read one field at a time, so a field a later Claude Code leaves out or
 * changes costs only what it would have shown. Questions the agent asks the user go to the board;
 * any other tool that needs the user at Claude Code itself is turned down at once, as the board
 * can't stand in for them.
 */
function toolRequest(
  id: string,
  request: Schema.JsonObject,
  root: string | undefined,
): AgentControl {
  const input = Option.getOrElse(decodeObject(request["input"]), (): Schema.JsonObject => ({}));
  const suggestions = Option.getOrElse(decodeList(request["permission_suggestions"]), () => []);
  const use: ToolUse = { id, input, suggestions, toolUseId: textOf(request, "tool_use_id") };

  const display = textOf(request, "display_name");
  const tool = textOf(request, "tool_name") ?? display ?? "tool";
  const question = tool === ASK_TOOL ? questionRequest(use) : Option.none();

  if (Option.isSome(question)) return question.value;

  if (request["requires_user_interaction"] === true) {
    return { kind: "reply", lines: [claudeAnswer(use, "deny", IN_PERSON)] };
  }

  const shown = (text: string | undefined) => (text === undefined ? text : shownText(text, root));

  // All of what the user agrees to, as Claude Code's own prompt shows it: the whole command or
  // path, or else every argument, such as the message a tool would send.
  const everything = Object.keys(input).length === 0 ? undefined : JSON.stringify(input, null, 2);

  const kind = KINDS.get(tool) ?? "tool";

  const approval = {
    id,
    tool,
    kind,
    network: kind === "network",
    title: shown(textOf(request, "title") ?? display),
    detail: Option.getOrElse(mainArgument(input, root), () =>
      shown(textOf(request, "blocked_path") ?? everything),
    ),
    reason: shown(textOf(request, "description") ?? textOf(request, "decision_reason")),
    always: suggestions.length > 0 && request["suppress_always_allow_rule"] !== true,
    rules: allowRules(suggestions),
    session: forSession(suggestions),
  };

  return {
    kind: "ask",
    request: { approval, answer: (answer) => claudeAnswer(use, choiceOf(answer)) },
  };
}

/** A request Claude Code waits on an answer to, or one it takes back. */
function claudeControl(
  type: string,
  json: Schema.JsonObject,
  root: string | undefined,
): Option.Option<AgentControl> {
  return Option.map(Option.fromUndefinedOr(textOf(json, "request_id")), (id): AgentControl => {
    if (type === "control_cancel_request") return { kind: "cancel", id };

    return Option.match(
      Option.filter(
        decodeObject(json["request"]),
        (request) => textOf(request, "subtype") === "can_use_tool",
      ),
      {
        onNone: () => ({ kind: "reply", lines: [claudeRefusal(id, UNSUPPORTED)] }),
        onSome: (request) => toolRequest(id, request, root),
      },
    );
  });
}

const CONTROL_TYPES = new Set(["control_request", "control_cancel_request"]);

/**
 * One line of `claude -p --output-format stream-json`. Paths under `root`, the workspace the agent
 * runs in, show relative to it.
 */
export function parseClaudeLine(line: string, root?: string): ParsedLine {
  const json = jsonLine(line);

  if (Option.isNone(json)) return NOTHING;
  const envelope = decodeClaudeEnvelope(json.value);

  if (Option.isNone(envelope)) return NOTHING;
  const msg = envelope.value;

  if (CONTROL_TYPES.has(msg.type)) {
    return {
      events: [],
      control: Option.getOrUndefined(claudeControl(msg.type, json.value, root)),
    };
  }

  // Claude Code words a failed sign-in as an assistant line too; the result carries it as the error.
  if (msg.type === "assistant" && msg.error === "authentication_failed") {
    return { events: [], sessionId: msg.session_id, signedOut: true };
  }

  const events = msg.type === "assistant" ? claudeEvents(json.value, root) : claudeCompaction(msg);

  if (msg.type !== "result") {
    return { events, sessionId: msg.session_id, effortKeepsCache: msg.per_turn_effort_active };
  }

  const failed = msg.is_error === true || msg.subtype !== "success";

  return {
    events,
    sessionId: msg.session_id,
    reply: failed ? undefined : msg.result,
    error: failed ? (msg.result ?? msg.errors?.[0] ?? msg.subtype ?? "Claude failed") : undefined,
    ended: true,
  };
}
