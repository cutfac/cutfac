import { Array, Context, Effect, Option, Order } from "effect";

import { agentBin, agentInvocation } from "./agentCommand.ts";
import { runPermissions } from "./agentPermissions.ts";
import {
  type CliEntry,
  codexRunServers,
  codexServerName,
  mcpLaunch,
  runMcpConfig,
} from "./agents.ts";
import { converse, noteCompaction } from "./agentTurn.ts";
import type { Ask } from "./approval.ts";
import { buildEditPrompt, editImages } from "./editPrompt.ts";
import { resolveEdit } from "./edits.ts";
import { baselineMillis, snapshotAfter } from "./editSnapshots.ts";
import { pendingVariants } from "./editVariants.ts";
import { beginEdit, waitingLine, waitingPick } from "./editWaiting.ts";
import type { CutfacError } from "./errors.ts";
import { findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import { approvedClaudeServers, approvedCodexServers } from "./mcpApprovals.ts";
import { codexServers } from "./mcpServers.ts";
import {
  type Emit,
  type RunSpec,
  type Runner,
  type Runs,
  firstLine,
  runsLayer,
} from "./runRegistry.ts";
import type { AgentName, AgentPick, AgentRun, ItemDoc } from "./schema.ts";
import { sourceHosts } from "./sources.ts";
import { nowIso } from "./time.ts";
import { Workspace } from "./workspace.ts";
import { askingTrusted, requireTrust } from "./workspaceTrust.ts";

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

const byStart = Order.mapInput(Order.String, (run: AgentRun) => run.startedAt);

/** How many runs on the item in a row failed just before now, which the next failure adds to. */
const failedBefore = (doc: ItemDoc): number => {
  const runs = Array.getSomes(doc.feedback.map((entry) => Option.fromUndefinedOr(entry.run)));

  return Array.match(runs, {
    onEmpty: () => 0,
    onNonEmpty: (some) => {
      const latest = Array.max(some, byStart);

      return latest.status === "failed" ? (latest.failedInARow ?? 1) : 0;
    },
  });
};

/** Where a run stands, as each save of it says. */
type RunState = Pick<AgentRun, "status" | "reply" | "error" | "signedOut" | "effortKeepsCache">;

/** Saves the run as it stands now, with what every save of it carries. */
type RecordRun = (state: RunState) => ReturnType<typeof setRun>;

const saveSession = (itemId: string, agent: AgentName, sessionId: string | undefined) =>
  mutateItem(itemId, (doc) =>
    Effect.succeed({ ...doc, sessions: { ...doc.sessions, [agent]: sessionId } }),
  );

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
 * The MCP servers the run loads: this workspace's, and the ones the user turned on in Setup. With
 * the CLI known, this workspace's server is always started for this root, so a copied or moved
 * workspace never acts on the one it came from.
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

    return { codexConfig: codexRunServers(ours, launch, listed, kept) };
  }

  const approved = yield* approvedClaudeServers();

  return {
    mcpConfig: yield* runMcpConfig(launch, approved.servers),
    env: approved.env,
  };
});

const performEdit = Effect.fnUntraced(function* (
  cli: CliEntry | undefined,
  input: RunInput,
  emit: Emit,
  record: RecordRun,
  ask: Ask,
) {
  const { itemId, feedbackId, agent, model, effort } = input;
  const pick: AgentPick = { agent, model, effort };
  // Before anything can fail, so the board shows the run, and any error, on this request.
  yield* emit({ type: "start", subject: feedbackId, ...pick });
  // First write, so a request that waited leaves the line before anything else can change it.
  const { item, feedback: f } = yield* beginEdit(itemId, feedbackId);
  const bin = yield* agentBin(agent);
  const trust = yield* requireTrust(agent);
  const prompt = yield* buildEditPrompt(item, f);
  const servers = yield* runServers(cli, agent, bin);
  const permissions = yield* runPermissions(agent);
  const images = yield* editImages(item, f);

  yield* record({ status: "running" });

  const { reply, failure, signedOut, effortKeepsCache } = yield* askingTrusted(
    trust,
    ask,
    (asking) =>
      converse({
        agent,
        stored: item.doc.sessions[agent],
        invocation: (session) =>
          Effect.succeed(
            agentInvocation(agent, {
              ...session,
              bin,
              prompt,
              ...servers,
              ...permissions,
              images,
              hosts: sourceHosts(item.doc.sources),
              model,
              effort,
            }),
          ),
        save: (sessionId) => saveSession(itemId, agent, sessionId),
        emit,
        ask: asking,
      }),
  );

  if (failure !== undefined) {
    yield* record({
      status: "failed",
      error: failure,
      signedOut,
      reply: reply === "" ? undefined : reply,
      effortKeepsCache,
    });

    return yield* emit({ type: "error", error: failure, signedOut });
  }

  yield* settleFeedback(input, reply);
  yield* record({ status: "done", reply, effortKeepsCache });
  yield* emit({ type: "done", reply });
});

/**
 * Run one edit request through the user's agent CLI, resuming the item's session, with `ask` taking
 * what the agent asks before a tool. Failures are recorded on the request and reported as an
 * `error` event; a stop keeps whatever the agent already wrote as the "after" side.
 */
export const runEdit = (cli: CliEntry | undefined) =>
  Effect.fn("agentRun.runEdit")(function* (input: RunInput, report: Emit, ask: Ask) {
    const { itemId, feedbackId, agent, model, effort } = input;
    const startedAt = yield* nowIso;
    const { emit, compacted } = yield* noteCompaction(report);

    // Read before this run's first save replaces the run it retries.
    const before = yield* getItem(itemId).pipe(
      Effect.map((item) => failedBefore(item.doc)),
      Effect.orElseSucceed(() => 0),
    );

    const record: RecordRun = (state) =>
      Effect.gen(function* () {
        const finishedAt = state.status === "running" ? undefined : yield* nowIso;
        const failedInARow = state.status === "failed" ? before + 1 : undefined;
        const run = { agent, model, effort, startedAt, ...state, failedInARow, finishedAt };

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

    yield* performEdit(cli, input, emit, record, ask).pipe(
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
