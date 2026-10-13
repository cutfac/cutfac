import {
  Cause,
  Context,
  Crypto,
  Effect,
  Fiber,
  FiberSet,
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

import {
  baselineMillis,
  beginEdit,
  buildEditPrompt,
  resolveEdit,
  snapshotAfter,
  waitingLine,
} from "./edits.ts";
import { CommandFailed, Conflict, type FactoryError } from "./errors.ts";
import { itemFormat } from "./formatSpec.ts";
import { findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import { commandOptions, spawnFailure, tail, which } from "./process.ts";
import { AgentName, type AgentRun } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/**
 * What the board shows while an agent works. `subject` is what the run is about: the request on an
 * item, or the turn of an import.
 */
export const RunEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("start"), subject: Schema.String, agent: AgentName }),
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

/** The session to resume, or the id to give a new one (Codex picks its own). */
export interface SessionArgs {
  readonly sessionId: string | undefined;
  readonly newSessionId: string;
}

export interface InvocationOptions extends SessionArgs {
  readonly bin: string;
  readonly prompt: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly mcpConfig?: string | undefined;
  readonly image?: string | undefined;
}

export interface AgentInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The prompt goes in on stdin so it never collides with option parsing or argv limits. */
  readonly stdin: string;
  /** Added to the environment the agent inherits. */
  readonly env?: Readonly<Record<string, string>>;
}

/** The workspace's allowed tools plus the ones the item's format asks for, each once. */
export const toolsFor = (
  workspace: ReadonlyArray<string>,
  format: ReadonlyArray<string>,
): ReadonlyArray<string> => [...new Set([...workspace, ...format])];

/** `claude -p` streaming JSON, with `flags` deciding what it may do. */
export function claudeCommand(
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  session: SessionArgs,
): AgentInvocation {
  return {
    command: bin,
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--permission-mode",
      "acceptEdits",
      ...flags,
      ...(session.sessionId === undefined
        ? ["--session-id", session.newSessionId]
        : ["--resume", session.sessionId]),
    ],
    stdin: prompt,
  };
}

/** `codex exec --json`, with `flags` deciding what it may do. */
export function codexCommand(
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  sessionId: string | undefined,
): AgentInvocation {
  const shared = ["--json", "--skip-git-repo-check", ...flags];

  return {
    command: bin,
    args:
      sessionId === undefined
        ? ["exec", ...shared, "-"]
        : ["exec", "resume", ...shared, sessionId, "-"],
    stdin: prompt,
  };
}

/**
 * Codex config overrides. `codex exec resume` takes no --sandbox flag, so policies always go
 * through config, which both forms accept.
 */
export const codexConfig = (entries: ReadonlyArray<string>) =>
  entries.flatMap((entry) => ["-c", entry]);

/** The agent's headless command line for `prompt`, with `flags` deciding what it may do. */
export const agentCommand = (
  agent: AgentName,
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  session: SessionArgs,
): AgentInvocation =>
  agent === "claude"
    ? claudeCommand(bin, prompt, flags, session)
    : codexCommand(bin, prompt, flags, session.sessionId);

/** Where the agent's CLI is, or a failure that says it is not installed. */
export const agentBin = (agent: AgentName) =>
  Effect.flatMap(
    which(agent),
    Option.match({
      onNone: () => Effect.fail(new CommandFailed({ message: `${agent} CLI not found on PATH` })),
      onSome: Effect.succeed,
    }),
  );

/** The headless command line for one edit request, resuming the item's session when it has one. */
export function agentInvocation(agent: AgentName, options: InvocationOptions): AgentInvocation {
  const { bin, prompt, mcpConfig, image } = options;

  const flags =
    agent === "claude"
      ? [
          "--allowedTools",
          options.allowedTools.join(","),
          ...(mcpConfig === undefined ? [] : ["--mcp-config", mcpConfig]),
        ]
      : [
          ...codexConfig(['sandbox_mode="workspace-write"', 'approval_policy="never"']),
          ...(image === undefined ? [] : ["--image", image]),
        ];

  return agentCommand(agent, bin, prompt, flags, options);
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
export type Runner<I, R> = (input: I, emit: Emit) => Effect.Effect<void, never, R>;

const MCP_FILE = ".mcp.json";

/** SIGTERM first so the agent can stop its own children; SIGKILL if it is still there after this. */
const STOP_GRACE = "3 seconds";

const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) ?? "";

/** A request with a run is no longer waiting for its turn. */
const setRun = (itemId: string, feedbackId: string, run: AgentRun) =>
  mutateItem(itemId, (doc) =>
    updateFeedback(doc, itemId, feedbackId, (entry) => ({ ...entry, run, waiting: undefined })),
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

/** Where a conversation keeps its session; `undefined` forgets it. */
export type SaveSession<R> = (
  sessionId: string | undefined,
) => Effect.Effect<void, FactoryError, R>;

/**
 * Spawn the agent, stream its stdout through `parse`, and save its session the moment it is known
 * so a stop or crash still leaves the next request in the same conversation. Closing the scope
 * (a stop) terminates the agent's whole process group.
 */
const attemptAgent = Effect.fnUntraced(function* <R>(
  agent: AgentName,
  invocation: AgentInvocation,
  storedSession: string | undefined,
  emit: Emit,
  save: SaveSession<R>,
) {
  const ws = yield* Workspace;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const parse = agent === "claude" ? parseClaudeLine : parseCodexLine;

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
      yield* save(parsed.sessionId);
    }

    yield* Ref.update(progress, (state) => ({
      reply: parsed.reply ?? state.reply,
      error: parsed.error ?? state.error,
      session: parsed.sessionId ?? state.session,
    }));
  });

  const command = ChildProcess.make(invocation.command, invocation.args, {
    ...commandOptions({ cwd: ws.root, stdin: invocation.stdin }),
    env: invocation.env,
    extendEnv: true,
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
  ).pipe(Effect.catchTag("PlatformError", (error) => Effect.fail(spawnFailure(agent)(error))));

  const attempt: Attempt = { ...(yield* Ref.get(progress)), ...exit };

  return attempt;
});

const failureOf = (agent: AgentName, attempt: Attempt) => {
  if (attempt.error !== undefined) return attempt.error;

  if (attempt.code === 0) return undefined;
  const detail = tail(attempt.stderr, 3);

  return detail === "" ? `${agent} exited with code ${attempt.code}` : detail;
};

/** One turn of a conversation with an agent that keeps its session somewhere persistent. */
export interface Conversation<R> {
  readonly agent: AgentName;
  /** The session to resume, if there is one. */
  readonly stored: string | undefined;
  /** The command line for the turn; with no session to resume, the prompt must stand alone. */
  readonly invocation: (session: SessionArgs) => Effect.Effect<AgentInvocation, FactoryError, R>;
  readonly save: SaveSession<R>;
  readonly emit: Emit;
}

export interface TurnResult {
  readonly reply: string;
  /** Why the turn failed, if it did. */
  readonly failure: string | undefined;
}

/** Run one turn, starting a fresh session when the stored one is gone. */
export const converse = Effect.fnUntraced(function* <R>(conversation: Conversation<R>) {
  const crypto = yield* Crypto.Crypto;
  const { agent, stored, save, emit } = conversation;

  const attempt = Effect.fnUntraced(function* (sessionId: string | undefined) {
    const newSessionId = yield* Effect.orDie(crypto.randomUUIDv4());
    const invocation = yield* conversation.invocation({ sessionId, newSessionId });

    return yield* attemptAgent(agent, invocation, sessionId, emit, save);
  });

  const first = yield* attempt(stored);

  // A resumed session the agent no longer has fails before it reports any session: start fresh.
  const staleSession =
    stored !== undefined && first.session === stored && failureOf(agent, first) !== undefined;

  const final = staleSession ? yield* Effect.andThen(save(undefined), attempt(undefined)) : first;
  const result: TurnResult = { reply: final.reply, failure: failureOf(agent, final) };

  return result;
});

/** The request is handled once its media changed, even if the agent forgot resolve_feedback. */
const settleFeedback = Effect.fnUntraced(function* (input: RunInput, reply: string) {
  const { itemId, feedbackId } = input;
  const item = yield* snapshotAfter(itemId, feedbackId);
  const f = yield* findFeedback(item, feedbackId);

  if (f.status !== "open") return;
  const since = baselineMillis(f);

  const changed =
    f.context?.before === undefined
      ? item.media.some((m) => m.mtime > since)
      : f.context.after !== undefined;

  if (changed) yield* resolveEdit(itemId, feedbackId, firstLine(reply) || "Edited by agent");
});

const performEdit = Effect.fnUntraced(function* (input: RunInput, emit: Emit, startedAt: string) {
  const ws = yield* Workspace;
  const { itemId, feedbackId, agent } = input;
  // First, so a request that waited leaves the line before anything else can change it.
  const { item, feedback: f } = yield* beginEdit(itemId, feedbackId);
  const bin = yield* agentBin(agent);
  const prompt = yield* buildEditPrompt(item, f);
  const format = yield* itemFormat(item.doc.format);
  const formatTools = Option.match(format, { onNone: () => [], onSome: (fmt) => fmt.doc.tools });
  const mcpConfig = (yield* ws.exists(MCP_FILE)) ? yield* ws.abs(MCP_FILE) : undefined;
  const frame = f.context?.frame;
  const image = frame === undefined ? undefined : yield* ws.abs(`${item.dir}/${frame}`);

  yield* setRun(itemId, feedbackId, { agent, status: "running", startedAt });
  yield* emit({ type: "start", subject: feedbackId, agent });

  const { reply, failure } = yield* converse({
    agent,
    stored: item.doc.sessions[agent],
    invocation: (session) =>
      Effect.succeed(
        agentInvocation(agent, {
          ...session,
          bin,
          prompt,
          allowedTools: toolsFor(ws.config.agent.claudeAllowedTools, formatTools),
          mcpConfig,
          image,
        }),
      ),
    save: (sessionId) => saveSession(itemId, agent, sessionId),
    emit,
  });

  const finishedAt = yield* nowIso;

  if (failure !== undefined) {
    yield* setRun(itemId, feedbackId, {
      agent,
      status: "failed",
      startedAt,
      finishedAt,
      error: failure,
      reply: reply === "" ? undefined : reply,
    });

    return yield* emit({ type: "error", error: failure });
  }

  yield* settleFeedback(input, reply);
  yield* setRun(itemId, feedbackId, { agent, status: "done", startedAt, finishedAt, reply });
  yield* emit({ type: "done", reply });
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
  /** What the latest run is about, if the key has had one since the server started. */
  readonly subject: Option.Option<string>;
  /** The latest run's events so far, then everything after, across later runs too. */
  readonly events: Stream.Stream<RunEvent>;
}

/** What a registry runs and how its runs are keyed. */
export interface RunSpec<I, R> {
  /** One run at a time per key, such as the item a request is on. */
  readonly key: (input: I) => string;
  /** What a run is about, sent to subscribers before its events. */
  readonly subject: (input: I) => string;
  /** Why a run cannot start while its key has one. */
  readonly busy: string;
  readonly runner: Runner<I, R>;
  /**
   * What the key has lined up after a run that finished its work, if anything. A run must take
   * itself out of the line when it starts, or it would be offered again.
   */
  readonly next?: (input: I) => Effect.Effect<Option.Option<I>, never, R>;
}

/** The runs of one kind, keyed by what they work on. */
export interface Runs<I> {
  readonly start: (input: I) => Effect.Effect<void, Conflict>;
  /**
   * Interrupt the key's run; resolves once the agent is gone and the stop is recorded. False when
   * no run was working, including one that already reported its end.
   */
  readonly stop: (key: string) => Effect.Effect<boolean>;
  /** Whether the key has a run that has not reported its end yet. */
  readonly isRunning: (key: string) => Effect.Effect<boolean>;
  readonly subscribe: (key: string) => Effect.Effect<RunSubscription, never, Scope.Scope>;
  /**
   * Run `effect` while no other exclusive effect on the key runs, so a check and the start it
   * guards, or a stop and what follows it, are not cut in on.
   */
  readonly exclusive: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

/** A run; it holds its key until it reports how it ended. */
interface LiveRun {
  fiber: Fiber.Fiber<void> | undefined;
  ended: RunEvent["type"] | undefined;
}

interface Channel {
  readonly pubsub: PubSub.PubSub<RunEvent>;
  /** Takes turns between exclusive effects on the key. */
  readonly turns: Semaphore.Semaphore;
  subject: Option.Option<string>;
  events: Array<RunEvent>;
  /** The run the key is busy with; the events of any other are late and dropped. */
  live: LiveRun | undefined;
}

const ENDINGS = new Set<RunEvent["type"]>(["done", "stopped", "error"]);

const crashMessage = (cause: Cause.Cause<never>) =>
  firstLine(Cause.pretty(cause)) || "The agent run crashed";

/**
 * One run at a time per key. A run holds its key until it reports its end, not until its fiber
 * is gone, so the next one can start as soon as the board hears it ended. A board that connects
 * mid-run, or reloads, gets the latest run's events replayed before live ones. Persistent state
 * lives in the workspace, not here.
 */
export const makeRunRegistry = Effect.fnUntraced(function* <I, R>(spec: RunSpec<I, R>) {
  const context = yield* Effect.context<R>();
  const fibers = yield* FiberSet.make();
  const channels = new Map<string, Channel>();
  // Recording an event and taking a snapshot for a new subscriber must not interleave, or a
  // subscriber would see an event twice or miss it.
  const lock = yield* Semaphore.make(1);
  const locked = lock.withPermits(1);

  const channelFor = (key: string) =>
    locked(
      Effect.gen(function* () {
        const existing = channels.get(key);

        if (existing !== undefined) return existing;

        const created: Channel = {
          pubsub: yield* PubSub.unbounded<RunEvent>(),
          turns: yield* Semaphore.make(1),
          subject: Option.none(),
          events: [],
          live: undefined,
        };

        channels.set(key, created);

        return created;
      }),
    );

  const emitTo =
    (channel: Channel, run: LiveRun): Emit =>
    (event) =>
      locked(
        Effect.suspend(() => {
          if (channel.live !== run) return Effect.void;

          if (ENDINGS.has(event.type)) {
            channel.live = undefined;
            run.ended = event.type;
          }

          channel.events.push(event);

          return PubSub.publish(channel.pubsub, event);
        }),
      );

  // A run that finished its work hands the key to the next one lined up. One that failed or was
  // stopped leaves the line for the user, and nothing starts while another run holds the key.
  const startNext = (input: I, channel: Channel) =>
    channel.turns.withPermits(1)(
      Effect.gen(function* () {
        if (spec.next === undefined || channel.live !== undefined) return;
        const next = yield* spec.next(input);

        if (Option.isSome(next)) yield* start(next.value).pipe(Effect.ignore);
      }),
    );

  // Every run reports one end: its own, or the one added here. Once it has, these are dropped,
  // such as the "stopped" of a stop that landed as the run finished.
  const supervise = (input: I, channel: Channel, run: LiveRun) => {
    const emit = emitTo(channel, run);

    return spec.runner(input, emit).pipe(
      Effect.andThen(emit({ type: "error", error: "The agent run ended without a result" })),
      Effect.onInterrupt(() => emit({ type: "stopped" })),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : emit({ type: "error", error: crashMessage(cause) }),
      ),
      Effect.andThen(() => (run.ended === "done" ? startNext(input, channel) : Effect.void)),
      Effect.provideContext(context),
    );
  };

  const start = (input: I): Effect.Effect<void, Conflict> =>
    Effect.gen(function* () {
      const channel = yield* channelFor(spec.key(input));

      yield* locked(
        Effect.gen(function* () {
          if (channel.live !== undefined) return yield* new Conflict({ message: spec.busy });

          // The run's first event waits for this lock, so its fiber is known by then.
          const run: LiveRun = { fiber: undefined, ended: undefined };
          channel.live = run;
          channel.subject = Option.some(spec.subject(input));
          channel.events = [];
          run.fiber = yield* FiberSet.run(fibers, supervise(input, channel, run));
        }),
      );
    });

  const stop = (key: string) =>
    Effect.gen(function* () {
      // Read under the lock, which a starting run holds until its fiber is known.
      const fiber = yield* locked(Effect.sync(() => channels.get(key)?.live?.fiber));

      if (fiber === undefined) return false;

      // Not under the lock: the run reports its stop through it.
      yield* Fiber.interrupt(fiber);

      return true;
    });

  const isRunning = (key: string) => Effect.sync(() => channels.get(key)?.live !== undefined);

  const subscribe = (key: string) =>
    Effect.gen(function* () {
      const channel = yield* channelFor(key);

      return yield* locked(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(channel.pubsub);
          const replay = [...channel.events];

          const result: RunSubscription = {
            subject: channel.subject,
            events: Stream.concat(
              Stream.fromIterable(replay),
              Stream.fromSubscription(subscription),
            ),
          };

          return result;
        }),
      );
    });

  const exclusive = <A, E, R2>(key: string, effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(channelFor(key), (channel) => channel.turns.withPermits(1)(effect));

  const registry: Runs<I> = { start, stop, isRunning, subscribe, exclusive };

  return registry;
});

/** A layer for `service` that runs `spec`, one run per key. */
export const runsLayer = <Self, I, R>(service: Context.Key<Self, Runs<I>>, spec: RunSpec<I, R>) =>
  Layer.effect(service, makeRunRegistry(spec));

/** The request on the item waiting longest for the board's agent. */
const nextWaiting = (input: RunInput) =>
  getItem(input.itemId).pipe(
    Effect.map((item) =>
      Option.map(Option.fromNullishOr(waitingLine(item.doc)[0]), (f): RunInput => ({
        itemId: input.itemId,
        feedbackId: f.id,
        agent: f.waiting,
      })),
    ),
    Effect.tapError((error) => Effect.logWarning("Could not read the waiting line", error)),
    Effect.orElseSucceed(() => Option.none<RunInput>()),
  );

/** Edit requests: one run per item, about one request on it; the item's waiting line runs in turn. */
export const editRuns = <R>(runner: Runner<RunInput, R>): RunSpec<RunInput, R | Workspace> => ({
  key: (input) => input.itemId,
  subject: (input) => input.feedbackId,
  busy: "An agent is already working on this item",
  runner,
  next: nextWaiting,
});

export class RunRegistry extends Context.Service<RunRegistry, Runs<RunInput>>()(
  "content-factory/RunRegistry",
) {
  static readonly layer = runsLayer(RunRegistry, editRuns(runEdit));
}
