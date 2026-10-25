import { Option, Predicate, Schema } from "effect";

import { Approval } from "./approval.ts";
import { AgentName, ModelSettings } from "./schema.ts";

/**
 * What the board shows while an agent works. `subject` is what the run is about: the request on an
 * item, or the turn of an import.
 */
export const RunEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("start"),
    subject: Schema.String,
    agent: AgentName,
    ...ModelSettings.fields,
  }),
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    name: Schema.String,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("done"), reply: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
  Schema.Struct({ type: Schema.Literal("error"), error: Schema.String }),
  /** The agent's own compaction of a long conversation: under way, done, or given up on. */
  Schema.Struct({
    type: Schema.Literal("compaction"),
    state: Schema.Literals(["running", "done", "failed"]),
  }),
  /** The agent asks before it uses a tool, and waits for the answer. */
  Schema.Struct({ type: Schema.Literal("approval"), ...Approval.fields }),
  /** The request was answered, here or elsewhere, or the agent took it back. */
  Schema.Struct({ type: Schema.Literal("approval-settled"), id: Schema.String }),
]);

export type RunEvent = typeof RunEvent.Type;

/** A tool the agent asks to use, with what its answer has to carry back. */
export interface ToolRequest {
  readonly approval: Approval;
  readonly input: Schema.JsonObject;
  /** The rules the agent would add to stop asking, which an Always allow hands back. */
  readonly suggestions: ReadonlyArray<Schema.Json>;
  readonly toolUseId: string | undefined;
  /** Whether the tool needs the user at the agent itself, which the board can't stand in for. */
  readonly inPerson: boolean;
}

/**
 * What Claude Code sends when it asks rather than answers: a request to use a tool, the withdrawal
 * of one, or a request of a kind the board doesn't answer.
 */
export type ClaudeControl =
  | { readonly kind: "ask"; readonly request: ToolRequest }
  | { readonly kind: "cancel"; readonly id: string }
  | { readonly kind: "unsupported"; readonly id: string };

/** What one line of agent output says. */
export interface ParsedLine {
  readonly events: ReadonlyArray<RunEvent>;
  /** A request the agent waits on an answer to. */
  readonly control?: ClaudeControl | undefined;
  readonly sessionId?: string | undefined;
  readonly reply?: string | undefined;
  readonly error?: string | undefined;
  /** Whether a change of effort alone keeps the conversation's prompt cache, when the line says. */
  readonly effortKeepsCache?: boolean | undefined;
  /** The agent's result for the turn, after which it takes no more input. */
  readonly ended?: true | undefined;
}

const NOTHING: ParsedLine = { events: [] };

const MAX_DETAIL = 160;

/** A string or a list of strings, the forms a tool's command or path argument takes. */
const DetailValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const decodeDetail = Schema.decodeUnknownOption(DetailValue);

const DETAIL_KEYS = ["command", "file_path", "path", "pattern", "url"] as const;

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with the workspace root taken out of its paths: `<root>/a.mp4` reads as `a.mp4` and the
 * root itself as `.`, so a tool line shows the part that matters and not the user's home folder.
 */
export const relativeToRoot = (text: string, root: string) =>
  text.replace(new RegExp(`${escapeRegExp(root)}(?:/|(?![\\w.-]))`, "g"), (match) =>
    match.endsWith("/") ? "" : ".",
  );

const shownText = (text: string, root: string | undefined) =>
  root === undefined ? text : relativeToRoot(text, root);

/** A command or path argument, or a list of them, as one line. */
const shownValue = (value: string | ReadonlyArray<string>, root: string | undefined) =>
  shownText(Predicate.isString(value) ? value : value.join(" "), root);

/** `text` cut short to fit on a tool line. */
const clamp = (text: string) =>
  text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}…` : text;

const clampDetail = (value: string | ReadonlyArray<string>, root: string | undefined) =>
  clamp(shownValue(value, root));

/** The one argument worth showing for a tool call, whole: its command, file, search pattern, or address. */
function mainArgument(input: Schema.JsonObject, root: string | undefined): string | undefined {
  for (const key of DETAIL_KEYS) {
    const value = decodeDetail(input[key]);

    if (Option.isSome(value)) return shownValue(value.value, root);
  }

  return undefined;
}

/** A tool call's main argument, cut short to fit on its line. */
function toolDetail(input: Schema.JsonObject, root: string | undefined): string | undefined {
  const text = mainArgument(input, root);

  return text === undefined ? undefined : clamp(text);
}

const decodeJsonLine = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** A JSON object line, or none for blank lines, banners, and other noise on stdout. */
const jsonLine = (line: string) =>
  line.trimStart().startsWith("{") ? decodeJsonLine(line) : Option.none<Schema.JsonObject>();

const ClaudeEnvelope = Schema.Struct({
  type: Schema.String,
  subtype: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  is_error: Schema.optional(Schema.Boolean),
  result: Schema.optional(Schema.String),
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
          const detail = block.input === undefined ? undefined : toolDetail(block.input, root);

          return [{ type: "tool", name: block.name, detail }];
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

const decodeText = Schema.decodeUnknownOption(Schema.String);

const decodeObject = Schema.decodeUnknownOption(Schema.JsonObject);

const decodeList = Schema.decodeUnknownOption(Schema.Array(Schema.Json));

/** A change to its permissions that Claude Code offers to make if the user allows always. */
const Suggestion = Schema.Struct({
  type: Schema.String,
  behavior: Schema.optional(Schema.String),
  rules: Schema.optional(
    Schema.Array(
      Schema.Struct({ toolName: Schema.String, ruleContent: Schema.optional(Schema.String) }),
    ),
  ),
});

const decodeSuggestion = Schema.decodeUnknownOption(Suggestion);

const ADDS_RULES = new Set(["addRules", "replaceRules"]);

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

/** A text field of `json`, or none when it is missing or something else. */
const textOf = (json: Schema.JsonObject, key: string) =>
  Option.getOrUndefined(decodeText(json[key]));

/**
 * A `can_use_tool` request, read one field at a time, so a field a later Claude Code leaves out or
 * changes costs only what it would have shown.
 */
function toolRequest(
  id: string,
  request: Schema.JsonObject,
  root: string | undefined,
): ToolRequest {
  const input = Option.getOrElse(decodeObject(request["input"]), (): Schema.JsonObject => ({}));
  const suggestions = Option.getOrElse(decodeList(request["permission_suggestions"]), () => []);
  const display = textOf(request, "display_name");

  const shown = (text: string | undefined) => (text === undefined ? text : shownText(text, root));

  // All of what the user agrees to, as Claude Code's own prompt shows it: the whole command or
  // path, or else every argument, such as the message a tool would send.
  const everything = Object.keys(input).length === 0 ? undefined : JSON.stringify(input, null, 2);

  return {
    approval: {
      id,
      tool: textOf(request, "tool_name") ?? display ?? "tool",
      title: shown(textOf(request, "title") ?? display),
      detail: mainArgument(input, root) ?? shown(textOf(request, "blocked_path") ?? everything),
      reason: shown(textOf(request, "description") ?? textOf(request, "decision_reason")),
      always: suggestions.length > 0 && request["suppress_always_allow_rule"] !== true,
      rules: allowRules(suggestions),
    },
    input,
    suggestions,
    toolUseId: textOf(request, "tool_use_id"),
    inPerson: request["requires_user_interaction"] === true,
  };
}

/** A request Claude Code waits on an answer to, or one it takes back. */
function claudeControl(
  type: string,
  json: Schema.JsonObject,
  root: string | undefined,
): ClaudeControl | undefined {
  const id = textOf(json, "request_id");

  if (id === undefined) return undefined;

  if (type === "control_cancel_request") return { kind: "cancel", id };
  const request = Option.getOrUndefined(decodeObject(json["request"]));

  return request !== undefined && textOf(request, "subtype") === "can_use_tool"
    ? { kind: "ask", request: toolRequest(id, request, root) }
    : { kind: "unsupported", id };
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
    return { events: [], control: claudeControl(msg.type, json.value, root) };
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
    error: failed ? (msg.result ?? msg.subtype ?? "Claude failed") : undefined,
    ended: true,
  };
}

const CodexEnvelope = Schema.Struct({
  type: Schema.String,
  thread_id: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  error: Schema.optional(Schema.Struct({ message: Schema.optional(Schema.String) })),
});

const decodeCodexEnvelope = Schema.decodeUnknownOption(CodexEnvelope);

const CodexItem = Schema.Struct({
  type: Schema.String,
  text: Schema.optional(Schema.String),
  command: Schema.optional(DetailValue),
  tool: Schema.optional(Schema.String),
  changes: Schema.optional(Schema.Array(Schema.Struct({ path: Schema.String }))),
});

type CodexItem = typeof CodexItem.Type;

const decodeCodexItem = Schema.decodeUnknownOption(CodexItem);

const codexItemLine = (phase: string, item: CodexItem, root: string | undefined): ParsedLine => {
  if (phase === "item.completed" && item.type === "agent_message") {
    const text = item.text ?? "";

    return text.trim() === "" ? NOTHING : { events: [{ type: "text", text }], reply: text };
  }

  if (phase === "item.started" && item.type === "command_execution") {
    const detail = item.command === undefined ? undefined : clampDetail(item.command, root);

    return { events: [{ type: "tool", name: "shell", detail }] };
  }

  if (phase === "item.started" && item.type === "mcp_tool_call") {
    return { events: [{ type: "tool", name: item.tool ?? "mcp", detail: undefined }] };
  }

  if (phase === "item.completed" && item.type === "file_change") {
    const paths = (item.changes ?? []).map((change) => change.path);

    return {
      events: [
        {
          type: "tool",
          name: "edit",
          detail: paths.length === 0 ? undefined : clampDetail(paths, root),
        },
      ],
    };
  }

  return NOTHING;
};

/** One line of `codex exec --json`, with paths under `root` relative to it. */
export function parseCodexLine(line: string, root?: string): ParsedLine {
  const json = jsonLine(line);

  if (Option.isNone(json)) return NOTHING;
  const envelope = decodeCodexEnvelope(json.value);

  if (Option.isNone(envelope)) return NOTHING;
  const msg = envelope.value;

  if (msg.type === "thread.started") return { events: [], sessionId: msg.thread_id };

  if (msg.type === "turn.failed" || msg.type === "error") {
    return { events: [], error: msg.error?.message ?? msg.message ?? "Codex failed" };
  }

  return Option.match(decodeCodexItem(json.value["item"]), {
    onNone: () => NOTHING,
    onSome: (item) => codexItemLine(msg.type, item, root),
  });
}
