import { Context, Crypto, Effect, Option, Ref, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import {
  type AgentInvocation,
  type SessionArgs,
  agentBin,
  agentInvocation,
  isSessionId,
  toolsFor,
} from "./agentCommand.ts";
import { type RunEvent, parseClaudeLine, parseCodexLine } from "./agentParse.ts";
import {
  CLAUDE_MCP_TOOLS,
  type CliEntry,
  codexRunServers,
  codexServerName,
  mcpLaunch,
  runMcpConfig,
} from "./agents.ts";
import { detectAgentRelease, unreadableOutputMessage } from "./agentVersion.ts";
import {
  baselineMillis,
  beginEdit,
  buildEditPrompt,
  editImages,
  pendingVariants,
  resolveEdit,
  snapshotAfter,
  waitingLine,
  waitingPick,
} from "./edits.ts";
import type { CutfacError } from "./errors.ts";
import { itemFormat } from "./formatSpec.ts";
import { findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import { approvedClaudeServers, approvedCodexServers } from "./mcpApprovals.ts";
import { codexServers } from "./mcpServers.ts";
import { commandOptions, spawnFailure, STOP_GRACE, tail } from "./process.ts";
import {
  type Emit,
  type RunSpec,
  type Runner,
  type Runs,
  firstLine,
  runsLayer,
} from "./runRegistry.ts";
import type { AgentName, AgentPick, AgentRun } from "./schema.ts";
import { sourceHosts } from "./sources.ts";
import { Workspace, nowIso } from "./workspace.ts";
import { requireTrust } from "./workspaceTrust.ts";

export interface RunInput extends AgentPick {
  readonly itemId: string;
  readonly feedbackId: string;
}

/** A request with a run is no longer waiting for its turn; the run keeps its model and effort. */
const setRun = (itemId: string, feedbackId: string, run: AgentRun) =>
  mutateItem(itemId, (doc) =>
    updateFeedback(doc, itemId, feedbackId, (entry) => ({
      ...entry,
      run,
      waiting: undefined,
      model: undefined,
      effort: undefined,
    })),
  );

/** Where a run stands, as each save of it says. */
type RunState = Pick<AgentRun, "status" | "reply" | "error" | "effortKeepsCache">;

/** Saves the run as it stands now, with what every save of it carries. */
type RecordRun = (state: RunState) => ReturnType<typeof setRun>;

/**
 * `emit`, keeping track of whether the agent compacted the conversation on the way, so the run's
 * record can say so once the streamed steps are gone.
 */
export const noteCompaction = (emit: Emit) =>
  Effect.map(Ref.make(false), (compacted) => ({
    emit: (event: RunEvent) =>
      Effect.andThen(
        event.type === "compaction" && event.state === "done"
          ? Ref.set(compacted, true)
          : Effect.void,
        emit(event),
      ),
    /** For the record: true once it has, left out until then. */
    compacted: Effect.map(Ref.get(compacted), (done) => done || undefined),
  }));

const saveSession = (itemId: string, agent: AgentName, sessionId: string | undefined) =>
  mutateItem(itemId, (doc) =>
    Effect.succeed({ ...doc, sessions: { ...doc.sessions, [agent]: sessionId } }),
  );

interface Progress {
  readonly reply: string;
  readonly error: string | undefined;
  /** The session the agent reported, once it has been saved to the item. */
  readonly session: string | undefined;
  /** Whether any line gave a session or a reply, which says the output could be read at all. */
  readonly understood: boolean;
  /** Whether a change of effort alone keeps the conversation's prompt cache, once the agent says. */
  readonly effortKeepsCache: boolean | undefined;
}

interface Attempt extends Progress {
  readonly code: number;
  readonly stderr: string;
  /** The agent ended well but said nothing that could be read: its output has likely changed. */
  readonly unreadable: boolean;
}

/** Where a conversation keeps its session; `undefined` forgets it. */
export type SaveSession<R> = (sessionId: string | undefined) => Effect.Effect<void, CutfacError, R>;

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
    understood: false,
    effortKeepsCache: undefined,
  });

  const onLine = Effect.fnUntraced(function* (line: string) {
    const parsed = parse(line, ws.root);
    yield* Effect.forEach(parsed.events, emit, { discard: true });
    const { session } = yield* Ref.get(progress);

    if (parsed.sessionId !== undefined && parsed.sessionId !== session) {
      yield* save(parsed.sessionId);
    }

    yield* Ref.update(progress, (state) => ({
      reply: parsed.reply ?? state.reply,
      error: parsed.error ?? state.error,
      session: parsed.sessionId ?? state.session,
      understood: state.understood || parsed.sessionId !== undefined || parsed.reply !== undefined,
      effortKeepsCache: parsed.effortKeepsCache ?? state.effortKeepsCache,
    }));
  });

  const command = ChildProcess.make(invocation.command, invocation.args, {
    ...commandOptions({ cwd: ws.root, stdin: invocation.stdin, env: invocation.env }),
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

  const read = yield* Ref.get(progress);

  // An exit code of 0 with nothing read is a change in the agent's output, not a quiet success.
  const unreadable = exit.code === 0 && read.error === undefined && !read.understood;

  const attempt: Attempt = {
    ...read,
    ...exit,
    error: unreadable
      ? unreadableOutputMessage(agent, yield* detectAgentRelease(invocation.command))
      : read.error,
    unreadable,
  };

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
  readonly invocation: (session: SessionArgs) => Effect.Effect<AgentInvocation, CutfacError, R>;
  readonly save: SaveSession<R>;
  readonly emit: Emit;
}

export interface TurnResult {
  readonly reply: string;
  /** Why the turn failed, if it did. */
  readonly failure: string | undefined;
  /** Whether a change of effort alone keeps the conversation's prompt cache, if the agent said. */
  readonly effortKeepsCache?: boolean | undefined;
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

  // Only a session the agent made goes back to it; anything else is replaced by a new one.
  const resumed = stored !== undefined && isSessionId(stored) ? stored : undefined;
  const first = yield* attempt(resumed);

  // A resumed session the agent no longer has fails before it reports any session: start fresh.
  const staleSession =
    resumed !== undefined &&
    first.session === resumed &&
    !first.unreadable &&
    failureOf(agent, first) !== undefined;

  const final = staleSession ? yield* Effect.andThen(save(undefined), attempt(undefined)) : first;

  const result: TurnResult = {
    reply: final.reply,
    failure: failureOf(agent, final),
    effortKeepsCache: final.effortKeepsCache,
  };

  return result;
});

/**
 * The request is handled once its media changed or versions of it were saved, even if the agent
 * forgot resolve_feedback.
 */
const settleFeedback = Effect.fnUntraced(function* (input: RunInput, reply: string) {
  const { itemId, feedbackId } = input;
  const item = yield* snapshotAfter(itemId, feedbackId);
  const f = yield* findFeedback(item, feedbackId);

  if (f.status !== "open") return;
  const since = baselineMillis(f);

  const changed =
    pendingVariants(f) ||
    (f.context?.before === undefined
      ? item.media.some((m) => m.mtime > since)
      : f.context.after !== undefined);

  if (changed) yield* resolveEdit(itemId, feedbackId, firstLine(reply) || "Edited by agent");
});

/**
 * The MCP servers the run loads: this workspace's, and the ones the user turned on in Setup, with
 * the tools Claude may call on them. With the CLI known, this workspace's server is always started
 * for this root, so a copied or moved workspace never acts on the one it came from.
 */
const runServers = Effect.fnUntraced(function* (
  cli: CliEntry | undefined,
  agent: AgentName,
  bin: string,
) {
  const ws = yield* Workspace;
  const launch = cli === undefined ? undefined : mcpLaunch(cli, ws.root);

  if (agent === "codex") {
    const ours = codexServerName(ws.config.name);
    const listed = yield* codexServers(bin);
    const kept = yield* approvedCodexServers(listed);

    return { codexServer: codexRunServers(ours, launch, listed, kept), tools: [] };
  }

  const approved = yield* approvedClaudeServers();

  return {
    mcpConfig: yield* runMcpConfig(launch, approved.servers),
    env: approved.env,
    tools: approved.tools,
  };
});

const performEdit = Effect.fnUntraced(function* (
  cli: CliEntry | undefined,
  input: RunInput,
  emit: Emit,
  record: RecordRun,
) {
  const ws = yield* Workspace;
  const { itemId, feedbackId, agent, model, effort } = input;
  const pick: AgentPick = { agent, model, effort };
  // Before anything can fail, so the board shows the run, and any error, on this request.
  yield* emit({ type: "start", subject: feedbackId, ...pick });
  // First write, so a request that waited leaves the line before anything else can change it.
  const { item, feedback: f } = yield* beginEdit(itemId, feedbackId);
  const bin = yield* agentBin(agent);
  yield* requireTrust(agent);
  const prompt = yield* buildEditPrompt(item, f);
  const format = yield* itemFormat(item.doc.format);
  const formatTools = Option.match(format, { onNone: () => [], onSome: (fmt) => fmt.doc.tools });
  const { tools: serverTools, ...servers } = yield* runServers(cli, agent, bin);
  const images = yield* editImages(item, f);

  yield* record({ status: "running" });

  const { reply, failure, effortKeepsCache } = yield* converse({
    agent,
    stored: item.doc.sessions[agent],
    invocation: (session) =>
      Effect.succeed(
        agentInvocation(agent, {
          ...session,
          bin,
          prompt,
          allowedTools: toolsFor(
            [...ws.config.agent.claudeAllowedTools, CLAUDE_MCP_TOOLS, ...serverTools],
            formatTools,
          ),
          ...servers,
          images,
          hosts: sourceHosts(item.doc.sources),
          model,
          effort,
        }),
      ),
    save: (sessionId) => saveSession(itemId, agent, sessionId),
    emit,
  });

  if (failure !== undefined) {
    yield* record({
      status: "failed",
      error: failure,
      reply: reply === "" ? undefined : reply,
      effortKeepsCache,
    });

    return yield* emit({ type: "error", error: failure });
  }

  yield* settleFeedback(input, reply);
  yield* record({ status: "done", reply, effortKeepsCache });
  yield* emit({ type: "done", reply });
});

/**
 * Run one edit request through the user's agent CLI, resuming the item's session. Failures are
 * recorded on the request and reported as an `error` event; a stop keeps whatever the agent
 * already wrote as the "after" side.
 */
export const runEdit = (cli: CliEntry | undefined) =>
  Effect.fn("agentRun.runEdit")(function* (input: RunInput, report: Emit) {
    const { itemId, feedbackId, agent, model, effort } = input;
    const startedAt = yield* nowIso;
    const { emit, compacted } = yield* noteCompaction(report);

    const record: RecordRun = (state) =>
      Effect.gen(function* () {
        const finishedAt = state.status === "running" ? undefined : yield* nowIso;
        const run = { agent, model, effort, startedAt, ...state, finishedAt };

        return yield* setRun(itemId, feedbackId, { ...run, compacted: yield* compacted });
      });

    const recordFailure = (error: CutfacError) =>
      Effect.andThen(
        record({ status: "failed", error: error.message }).pipe(Effect.ignore({ log: true })),
        emit({ type: "error", error: error.message }),
      );

    const recordStop = Effect.andThen(
      snapshotAfter(itemId, feedbackId),
      record({ status: "stopped" }),
    ).pipe(Effect.ignore({ log: true }));

    yield* performEdit(cli, input, emit, record).pipe(
      Effect.catch(recordFailure),
      Effect.onInterrupt(() => recordStop),
    );
  });

/** The request on the item waiting longest for the board's agent. */
const nextWaiting = (input: RunInput) =>
  getItem(input.itemId).pipe(
    Effect.map((item) =>
      Option.map(Option.fromNullishOr(waitingLine(item.doc)[0]), (f): RunInput => ({
        itemId: input.itemId,
        feedbackId: f.id,
        ...waitingPick(f),
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
  "cutfac/RunRegistry",
) {
  /** `cli` is how agents start this CLI's MCP server, when the server knows it. */
  static readonly layer = (cli: CliEntry | undefined) =>
    runsLayer(RunRegistry, editRuns(runEdit(cli)));
}
