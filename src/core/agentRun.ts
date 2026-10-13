import {
  Cause,
  Context,
  Crypto,
  Effect,
  FiberMap,
  Layer,
  Option,
  Predicate,
  PubSub,
  Ref,
  Schema,
  Scope,
  Semaphore,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { buildEditPrompt, requestedAtMillis, resolveEdit, snapshotAfter } from "./edits.ts";
import { CommandFailed, Conflict, type FactoryError } from "./errors.ts";
import { itemFormat } from "./formatSpec.ts";
import { findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import { commandOptions, spawnFailure, tail, which } from "./process.ts";
import { AgentName, type AgentRun } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** What the board shows while an agent works on a request. */
export const RunEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start"), feedbackId: Schema.String, agent: AgentName }),
  Schema.Struct({ type: Schema.Literal("text"), text: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("tool"),
    name: Schema.String,
    detail: Schema.optional(Schema.String),
  }),
  Schema.Struct({ type: Schema.Literal("done"), reply: Schema.String }),
  Schema.Struct({ type: Schema.Literal("stopped") }),
  Schema.Struct({ type: Schema.Literal("error"), error: Schema.String }),
]);

export type RunEvent = typeof RunEvent.Type;

/** What one line of agent output says. */
export interface ParsedLine {
  readonly events: ReadonlyArray<RunEvent>;
  readonly sessionId?: string | undefined;
  readonly reply?: string | undefined;
  readonly error?: string | undefined;
}

const NOTHING: ParsedLine = { events: [] };

export interface InvocationOptions {
  readonly bin: string;
  readonly prompt: string;
  readonly sessionId: string | undefined;
  readonly newSessionId: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly mcpConfig?: string | undefined;
  readonly image?: string | undefined;
}

export interface AgentInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The prompt goes in on stdin so it never collides with option parsing or argv limits. */
  readonly stdin: string;
}

/** The workspace's allowed tools plus the ones the item's format asks for, each once. */
export const toolsFor = (
  workspace: ReadonlyArray<string>,
  format: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set([...workspace, ...format])];

/** The headless command line for one request, resuming the item's session when it has one. */
export function agentInvocation(agent: AgentName, options: InvocationOptions): AgentInvocation {
  const { bin, prompt, sessionId, mcpConfig, image } = options;

  if (agent === "claude") {
    return {
      command: bin,
      args: [
        "-p",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "acceptEdits",
        "--allowedTools",
        options.allowedTools.join(","),
        ...(mcpConfig === undefined ? [] : ["--mcp-config", mcpConfig]),
        ...(sessionId === undefined
          ? ["--session-id", options.newSessionId]
          : ["--resume", sessionId]),
      ],
      stdin: prompt,
    };
  }

  // `codex exec resume` takes no --sandbox flag, so set the policy through config for both forms.
  const shared = [
    "--json",
    "--skip-git-repo-check",
    "-c",
    'sandbox_mode="workspace-write"',
    "-c",
    'approval_policy="never"',
    ...(image === undefined ? [] : ["--image", image]),
  ];

  return {
    command: bin,
    args:
      sessionId === undefined
        ? ["exec", ...shared, "-"]
        : ["exec", "resume", ...shared, sessionId, "-"],
    stdin: prompt,
  };
}

const MAX_DETAIL = 160;

/** A string or a list of strings, the forms a tool's command or path argument takes. */
const DetailValue = Schema.Union([Schema.String, Schema.Array(Schema.String)]);

const decodeDetail = Schema.decodeUnknownOption(DetailValue);

const DETAIL_KEYS = ["command", "file_path", "path", "pattern"] as const;

const clampDetail = (value: string | ReadonlyArray<string>) => {
  const text = Predicate.isString(value) ? value : value.join(" ");

  return text.length > MAX_DETAIL ? `${text.slice(0, MAX_DETAIL - 3)}…` : text;
};

/** The one argument worth showing for a tool call: its command, file, or search pattern. */
export function toolDetail(input: Schema.JsonObject): string | undefined {
  for (const key of DETAIL_KEYS) {
    const value = decodeDetail(input[key]);

    if (Option.isSome(value)) return clampDetail(value.value);
  }

  return undefined;
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
});

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

const claudeEvents = (json: Schema.JsonObject): ReadonlyArray<RunEvent> =>
  Option.match(decodeClaudeMessage(json["message"]), {
    onNone: () => [],
    onSome: (message) =>
      message.content.flatMap((block): ReadonlyArray<RunEvent> => {
        if (block.type === "text" && block.text !== undefined && block.text.trim() !== "") {
          return [{ type: "text", text: block.text }];
        }

        if (block.type === "tool_use" && block.name !== undefined) {
          const detail = block.input === undefined ? undefined : toolDetail(block.input);

          return [{ type: "tool", name: block.name, detail }];
        }

        return [];
      }),
  });

/** One line of `claude -p --output-format stream-json`. */
export function parseClaudeLine(line: string): ParsedLine {
  const json = jsonLine(line);

  if (Option.isNone(json)) return NOTHING;
  const envelope = decodeClaudeEnvelope(json.value);

  if (Option.isNone(envelope)) return NOTHING;
  const msg = envelope.value;
  const events = msg.type === "assistant" ? claudeEvents(json.value) : [];

  if (msg.type !== "result") return { events, sessionId: msg.session_id };
  const failed = msg.is_error === true || msg.subtype !== "success";

  return {
    events,
    sessionId: msg.session_id,
    reply: failed ? undefined : msg.result,
    error: failed ? (msg.result ?? msg.subtype ?? "Claude failed") : undefined,
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

const codexItemLine = (phase: string, item: CodexItem): ParsedLine => {
  if (phase === "item.completed" && item.type === "agent_message") {
    const text = item.text ?? "";

    return text.trim() === "" ? NOTHING : { events: [{ type: "text", text }], reply: text };
  }

  if (phase === "item.started" && item.type === "command_execution") {
    const detail = item.command === undefined ? undefined : clampDetail(item.command);

    return { events: [{ type: "tool", name: "shell", detail }] };
  }

  if (phase === "item.started" && item.type === "mcp_tool_call") {
    return { events: [{ type: "tool", name: item.tool ?? "mcp", detail: undefined }] };
  }

  if (phase === "item.completed" && item.type === "file_change") {
    const paths = (item.changes ?? []).map((change) => change.path);

    return {
      events: [
        { type: "tool", name: "edit", detail: paths.length === 0 ? undefined : clampDetail(paths) },
      ],
    };
  }

  return NOTHING;
};

/** One line of `codex exec --json`. */
export function parseCodexLine(line: string): ParsedLine {
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
    onSome: (item) => codexItemLine(msg.type, item),
  });
}

export interface RunInput {
  readonly itemId: string;
  readonly feedbackId: string;
  readonly agent: AgentName;
}

export type Emit = (event: RunEvent) => Effect.Effect<void>;

/** Runs one request to the end, reporting progress through `emit`. Never fails: errors become events. */
export type EditRunner<R> = (input: RunInput, emit: Emit) => Effect.Effect<void, never, R>;

const MCP_FILE = ".mcp.json";

/** SIGTERM first so the agent can stop its own children; SIGKILL if it is still there after this. */
const STOP_GRACE = "3 seconds";

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) ?? "";

const setRun = (itemId: string, feedbackId: string, run: AgentRun) =>
  mutateItem(itemId, (doc) =>
    updateFeedback(doc, itemId, feedbackId, (entry) => ({ ...entry, run })),
  );

const saveSession = (itemId: string, agent: AgentName, sessionId: string | undefined) =>
  mutateItem(itemId, (doc) =>
    Effect.succeed({ ...doc, sessions: { ...doc.sessions, [agent]: sessionId } }),
  );

interface Progress {
  readonly reply: string;
  readonly error: string | undefined;
  /** The session the agent reported, once it has been saved to the item. */
  readonly session: string | undefined;
}

interface Attempt extends Progress {
  readonly code: number;
  readonly stderr: string;
}

/**
 * Spawn the agent, stream its stdout through `parse`, and save its session the moment it is known
 * so a stop or crash still leaves the next request in the same conversation. Closing the scope
 * (a stop) terminates the agent's whole process group.
 */
const attemptAgent = Effect.fnUntraced(function* (
  input: RunInput,
  invocation: AgentInvocation,
  storedSession: string | undefined,
  emit: Emit,
) {
  const ws = yield* Workspace;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parse = input.agent === "claude" ? parseClaudeLine : parseCodexLine;

  const progress = yield* Ref.make<Progress>({
    reply: "",
    error: undefined,
    session: storedSession,
  });

  const onLine = Effect.fnUntraced(function* (line: string) {
    const parsed = parse(line);
    yield* Effect.forEach(parsed.events, emit, { discard: true });
    const { session } = yield* Ref.get(progress);

    if (parsed.sessionId !== undefined && parsed.sessionId !== session) {
      yield* saveSession(input.itemId, input.agent, parsed.sessionId);
    }

    yield* Ref.update(progress, (state) => ({
      reply: parsed.reply ?? state.reply,
      error: parsed.error ?? state.error,
      session: parsed.sessionId ?? state.session,
    }));
  });

  const command = ChildProcess.make(invocation.command, invocation.args, {
    ...commandOptions({ cwd: ws.root, stdin: invocation.stdin }),
    forceKillAfter: STOP_GRACE,
  });

  const exit = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);

      const [, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(onLine)),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      return { stderr, code };
    }),
  ).pipe(
    Effect.catchTag("PlatformError", (error) => Effect.fail(spawnFailure(input.agent)(error))),
  );

  const attempt: Attempt = { ...(yield* Ref.get(progress)), ...exit };

  return attempt;
});

const failureOf = (agent: AgentName, attempt: Attempt) => {
  if (attempt.error !== undefined) return attempt.error;

  if (attempt.code === 0) return undefined;
  const detail = tail(attempt.stderr, 3);

  return detail === "" ? `${agent} exited with code ${attempt.code}` : detail;
};

/** The request is handled once its media changed, even if the agent forgot resolve_feedback. */
const settleFeedback = Effect.fnUntraced(function* (input: RunInput, reply: string) {
  const { itemId, feedbackId } = input;
  const item = yield* snapshotAfter(itemId, feedbackId);
  const f = yield* findFeedback(item, feedbackId);

  if (f.status !== "open") return;
  const since = requestedAtMillis(f);

  const changed =
    f.context?.before === undefined
      ? item.media.some((m) => m.mtime > since)
      : f.context.after !== undefined;

  if (changed) yield* resolveEdit(itemId, feedbackId, firstLine(reply) || "Edited by agent");
});

const performEdit = Effect.fnUntraced(function* (input: RunInput, emit: Emit, startedAt: string) {
  const ws = yield* Workspace;
  const crypto = yield* Crypto.Crypto;
  const { itemId, feedbackId, agent } = input;
  const bin = yield* which(agent);

  if (Option.isNone(bin)) {
    return yield* new CommandFailed({ message: `${agent} CLI not found on PATH` });
  }

  const item = yield* getItem(itemId);
  const f = yield* findFeedback(item, feedbackId);
  const prompt = yield* buildEditPrompt(item, f);
  const format = yield* itemFormat(item.doc.format);
  const formatTools = Option.match(format, { onNone: () => [], onSome: (fmt) => fmt.doc.tools });
  const mcpConfig = (yield* ws.exists(MCP_FILE)) ? yield* ws.abs(MCP_FILE) : undefined;
  const frame = f.context?.frame;
  const image = frame === undefined ? undefined : yield* ws.abs(`${item.dir}/${frame}`);

  const invocationFor = Effect.fnUntraced(function* (sessionId: string | undefined) {
    const newSessionId = yield* Effect.orDie(crypto.randomUUIDv4());

    return agentInvocation(agent, {
      bin: bin.value,
      prompt,
      sessionId,
      newSessionId,
      allowedTools: toolsFor(ws.config.agent.claudeAllowedTools, formatTools),
      mcpConfig,
      image,
    });
  });

  yield* setRun(itemId, feedbackId, { agent, status: "running", startedAt });
  yield* emit({ type: "start", feedbackId, agent });

  const stored = item.doc.sessions[agent];
  const first = yield* attemptAgent(input, yield* invocationFor(stored), stored, emit);

  // A resumed session the agent no longer has fails before it reports any session: start fresh.
  const staleSession =
    stored !== undefined && first.session === stored && failureOf(agent, first) !== undefined;

  const attempt = staleSession
    ? yield* saveSession(itemId, agent, undefined).pipe(
        Effect.andThen(invocationFor(undefined)),
        Effect.flatMap((invocation) => attemptAgent(input, invocation, undefined, emit)),
      )
    : first;

  const failure = failureOf(agent, attempt);
  const finishedAt = yield* nowIso;

  if (failure !== undefined) {
    const reply = attempt.reply === "" ? undefined : attempt.reply;
    yield* setRun(itemId, feedbackId, {
      agent,
      status: "failed",
      startedAt,
      finishedAt,
      error: failure,
      reply,
    });

    return yield* emit({ type: "error", error: failure });
  }

  yield* settleFeedback(input, attempt.reply);
  yield* setRun(itemId, feedbackId, {
    agent,
    status: "done",
    startedAt,
    finishedAt,
    reply: attempt.reply,
  });
  yield* emit({ type: "done", reply: attempt.reply });
});

/**
 * Run one edit request through the user's agent CLI, resuming the item's session. Failures are
 * recorded on the request and reported as an `error` event; a stop keeps whatever the agent
 * already wrote as the "after" side.
 */
export const runEdit = Effect.fn("agentRun.runEdit")(function* (input: RunInput, emit: Emit) {
  const { itemId, feedbackId, agent } = input;
  const startedAt = yield* nowIso;

  const recordFailure = (error: FactoryError) =>
    Effect.gen(function* () {
      const finishedAt = yield* nowIso;
      yield* setRun(itemId, feedbackId, {
        agent,
        status: "failed",
        startedAt,
        finishedAt,
        error: error.message,
      }).pipe(Effect.ignore({ log: true }));
      yield* emit({ type: "error", error: error.message });
    });

  const recordStop = Effect.gen(function* () {
    yield* snapshotAfter(itemId, feedbackId);
    const finishedAt = yield* nowIso;
    yield* setRun(itemId, feedbackId, { agent, status: "stopped", startedAt, finishedAt });
  }).pipe(Effect.ignore({ log: true }));

  yield* performEdit(input, emit, startedAt).pipe(
    Effect.catch(recordFailure),
    Effect.onInterrupt(() => recordStop),
  );
});

export interface RunSubscription {
  /** The request the latest run is about, if the item has had one since the server started. */
  readonly feedbackId: Option.Option<string>;
  /** The latest run's events so far, then everything after, across later runs too. */
  readonly events: Stream.Stream<RunEvent>;
}

interface ItemChannel {
  readonly pubsub: PubSub.PubSub<RunEvent>;
  feedbackId: Option.Option<string>;
  events: Array<RunEvent>;
}

const crashMessage = (cause: Cause.Cause<never>) =>
  firstLine(Cause.pretty(cause)) || "The agent run crashed";

/**
 * One run at a time per item. A board that connects mid-run, or reloads, gets the latest run's
 * events replayed before live ones. Persistent state lives in item.yaml, not here.
 */
export const makeRunRegistry = Effect.fnUntraced(function* <R>(runner: EditRunner<R>) {
  const context = yield* Effect.context<R>();
  const runs = yield* FiberMap.make<string>();
  const channels = new Map<string, ItemChannel>();
  // Recording an event and taking a snapshot for a new subscriber must not interleave, or a
  // subscriber would see an event twice or miss it.
  const lock = yield* Semaphore.make(1);
  const locked = lock.withPermits(1);

  const channelFor = Effect.fnUntraced(function* (itemId: string) {
    const existing = channels.get(itemId);

    if (existing !== undefined) return existing;

    const created: ItemChannel = {
      pubsub: yield* PubSub.unbounded<RunEvent>(),
      feedbackId: Option.none(),
      events: [],
    };

    channels.set(itemId, created);

    return created;
  });

  const emitTo =
    (channel: ItemChannel): Emit =>
    (event) =>
      locked(
        Effect.suspend(() => {
          channel.events.push(event);

          return PubSub.publish(channel.pubsub, event);
        }),
      );

  const supervise = (input: RunInput, channel: ItemChannel) => {
    const emit = emitTo(channel);

    return runner(input, emit).pipe(
      Effect.onInterrupt(() => emit({ type: "stopped" })),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : emit({ type: "error", error: crashMessage(cause) }),
      ),
      Effect.provideContext(context),
    );
  };

  const start = (input: RunInput) =>
    locked(
      Effect.gen(function* () {
        if (yield* FiberMap.has(runs, input.itemId)) {
          return yield* new Conflict({ message: "An agent is already working on this item" });
        }

        const channel = yield* channelFor(input.itemId);
        channel.feedbackId = Option.some(input.feedbackId);
        channel.events = [];
        yield* FiberMap.run(runs, input.itemId, supervise(input, channel), { onlyIfMissing: true });
      }),
    );

  /** Interrupt the item's run; resolves once the agent is gone and the stop is recorded. */
  const stop = (itemId: string) =>
    Effect.gen(function* () {
      const running = yield* FiberMap.has(runs, itemId);

      if (running) yield* FiberMap.remove(runs, itemId);

      return running;
    });

  const isRunning = (itemId: string) => FiberMap.has(runs, itemId);

  const subscribe = (itemId: string) =>
    locked(
      Effect.gen(function* () {
        const channel = yield* channelFor(itemId);
        const subscription = yield* PubSub.subscribe(channel.pubsub);
        const replay = [...channel.events];

        const result: RunSubscription = {
          feedbackId: channel.feedbackId,
          events: Stream.concat(Stream.fromIterable(replay), Stream.fromSubscription(subscription)),
        };

        return result;
      }),
    );

  return { start, stop, isRunning, subscribe };
});

export class RunRegistry extends Context.Service<
  RunRegistry,
  {
    readonly start: (input: RunInput) => Effect.Effect<void, Conflict>;
    readonly stop: (itemId: string) => Effect.Effect<boolean>;
    readonly isRunning: (itemId: string) => Effect.Effect<boolean>;
    readonly subscribe: (itemId: string) => Effect.Effect<RunSubscription, never, Scope.Scope>;
  }
>()("content-factory/RunRegistry") {
  static readonly layer = Layer.effect(RunRegistry, makeRunRegistry(runEdit));
}
