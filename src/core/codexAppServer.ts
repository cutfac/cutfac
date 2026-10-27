import { Option, Schema } from "effect";

import {
  NOTHING,
  type ParsedLine,
  clampDetail,
  jsonLine,
  textOf,
  toolDetail,
} from "./agentParse.ts";
import { serverRequest } from "./codexApprovals.ts";
import {
  type CodexRun,
  INITIALIZE,
  type RequestId,
  THREAD,
  TURN,
  decodeRequestId,
  objectOf,
  reply,
  threadRequest,
  turnRequest,
} from "./codexProtocol.ts";
import { shellScript } from "./shellWords.ts";

const decodeChanges = Schema.decodeUnknownOption(
  Schema.Array(Schema.Struct({ path: Schema.String })),
);

/**
 * What a run keeps between lines: its thread and turn, the error Codex gave up on, and the files
 * each of its changes touches.
 */
interface TurnState {
  threadId: string | undefined;
  turnId: string | undefined;
  error: string | undefined;
  readonly changes: Map<string, ReadonlyArray<string>>;
}

const failed = (error: string): ParsedLine => ({ events: [], error, ended: true });

/** The `id` of the object at `key`, as threads and turns carry theirs. */
const idOf = (json: Schema.JsonObject, key: string) => {
  const object = objectOf(json, key);

  return object === undefined ? undefined : textOf(object, "id");
};

const messageOf = (json: Schema.JsonObject) => {
  const error = objectOf(json, "error");

  return error === undefined ? undefined : textOf(error, "message");
};

/** Codex's answer to one of the run's own requests, which moves the run on to the next. */
function response(
  id: RequestId,
  json: Schema.JsonObject,
  run: CodexRun,
  state: TurnState,
): ParsedLine {
  if (objectOf(json, "error") !== undefined) return failed(messageOf(json) ?? "Codex failed");
  const result = objectOf(json, "result") ?? {};

  if (id === INITIALIZE) {
    return { events: [], control: reply({ method: "initialized" }, threadRequest(run)) };
  }

  if (id === TURN) {
    state.turnId = idOf(result, "turn");

    return NOTHING;
  }

  if (id !== THREAD) return NOTHING;
  const threadId = idOf(result, "thread");

  if (threadId === undefined) return failed("Codex started no thread");
  state.threadId = threadId;

  return { events: [], sessionId: threadId, control: reply(turnRequest(run, threadId)) };
}

const tool = (name: string, detail: string | undefined): ParsedLine => ({
  events: [{ type: "tool", name, detail }],
});

const compaction = (state: "running" | "done"): ParsedLine => ({
  events: [{ type: "compaction", state }],
});

/** An item of the turn as it starts: what Codex goes to do. */
function itemStarted(item: Schema.JsonObject, state: TurnState, root: string | undefined) {
  switch (textOf(item, "type")) {
    case "commandExecution": {
      const command = textOf(item, "command");

      return tool(
        "shell",
        command === undefined ? undefined : clampDetail(shellScript(command), root),
      );
    }

    case "fileChange": {
      const paths = Option.getOrElse(decodeChanges(item["changes"]), () => []).map((c) => c.path);
      const itemId = textOf(item, "id");

      if (itemId !== undefined) state.changes.set(itemId, paths);

      return tool("edit", paths.length === 0 ? undefined : clampDetail(paths, root));
    }

    case "mcpToolCall":
    case "dynamicToolCall":
      return tool(
        textOf(item, "tool") ?? "tool",
        Option.getOrUndefined(toolDetail(objectOf(item, "arguments") ?? {}, root)),
      );

    case "contextCompaction":
      return compaction("running");

    default:
      return NOTHING;
  }
}

/** An item of the turn as it ends: what Codex said, searched, or compacted. */
function itemCompleted(item: Schema.JsonObject, root: string | undefined): ParsedLine {
  switch (textOf(item, "type")) {
    case "agentMessage": {
      const text = textOf(item, "text") ?? "";

      return text.trim() === "" ? NOTHING : { events: [{ type: "text", text }], reply: text };
    }

    case "webSearch": {
      const query = textOf(item, "query");

      return tool(
        "WebSearch",
        query === undefined || query === "" ? undefined : clampDetail(query, root),
      );
    }

    case "contextCompaction":
      return compaction("done");

    default:
      return NOTHING;
  }
}

/**
 * The turn's end; anything but a completed turn is its failure, with the error the turn gives or
 * else the last one Codex gave up on.
 */
function turnCompleted(turn: Schema.JsonObject, state: TurnState): ParsedLine {
  if (textOf(turn, "status") === "completed") return { events: [], ended: true };

  return failed(messageOf(turn) ?? state.error ?? "Codex failed");
}

/** Whether `turnId` is the run's own turn, or may be, while Codex hasn't said which that is. */
const ownTurn = (turnId: string | undefined, state: TurnState) =>
  state.turnId === undefined || turnId === state.turnId;

/**
 * A notification about the run's own thread. Subagents work in threads of their own, which tell
 * the run nothing about its turn, though what they ask still goes to the board.
 */
function notification(
  method: string,
  params: Schema.JsonObject,
  state: TurnState,
  root: string | undefined,
): ParsedLine {
  if (method === "serverRequest/resolved") {
    return Option.match(decodeRequestId(params["requestId"]), {
      onNone: () => NOTHING,
      onSome: (id) => ({ events: [], control: { kind: "cancel", id: String(id) } }),
    });
  }

  if (state.threadId === undefined || textOf(params, "threadId") !== state.threadId) return NOTHING;
  const item = objectOf(params, "item");

  switch (method) {
    case "item/started":
      return item === undefined ? NOTHING : itemStarted(item, state, root);
    case "item/completed":
      return item === undefined ? NOTHING : itemCompleted(item, root);
    case "turn/completed": {
      const turn = objectOf(params, "turn") ?? {};

      return ownTurn(textOf(turn, "id"), state) ? turnCompleted(turn, state) : NOTHING;
    }

    // An error Codex won't try again fails the turn, which still ends with `turn/completed`, as
    // `codex exec` waits for it.
    case "error":
      if (params["willRetry"] !== true && ownTurn(textOf(params, "turnId"), state)) {
        state.error = messageOf(params) ?? state.error;
      }

      return NOTHING;

    default:
      return NOTHING;
  }
}

/**
 * The reader for one turn of `codex app-server`: each line Codex writes, with what the run sends
 * back, so the connection opens, the thread starts or resumes, and the turn runs. Paths under
 * `root`, the workspace the run is in, show relative to it.
 */
export function codexTurn(run: CodexRun): (line: string, root: string | undefined) => ParsedLine {
  const state: TurnState = {
    threadId: undefined,
    turnId: undefined,
    error: undefined,
    changes: new Map(),
  };

  return (text, root) => {
    const json = jsonLine(text);

    if (Option.isNone(json)) return NOTHING;
    const message = json.value;
    const method = textOf(message, "method");
    const id = Option.getOrUndefined(decodeRequestId(message["id"]));
    const params = objectOf(message, "params") ?? {};

    if (method === undefined) return id === undefined ? NOTHING : response(id, message, run, state);

    if (id === undefined) return notification(method, params, state, root);

    return { events: [], control: serverRequest(id, method, params, state.changes, root) };
  };
}
