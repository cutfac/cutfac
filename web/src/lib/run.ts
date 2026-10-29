import { Option } from "effect";

import type {
  AgentName,
  AgentRun,
  EditInput,
  EditReceipt,
  Feedback,
  ItemDetail,
  ModelSettings,
  RunMessage,
} from "../api.ts";
import type { Approval } from "../approvalsApi.ts";
import type { NamedSettings } from "./models.ts";

export type RunStep =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly detail?: string }
  /** The agent compacted the conversation here, and went on from a summary of it. */
  | { readonly kind: "compaction" };

const COMPACTION: RunStep = { kind: "compaction" };

/** The agent's latest run, as the chat shows it while it streams. */
export interface LiveRun {
  /** What the run is about: a request on an item, or a turn of an import. */
  readonly subject: string | undefined;
  readonly agent: AgentName | undefined;
  /** The model and effort the run was started with; left out, the agent's defaults. */
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  readonly status: AgentRun["status"];
  readonly steps: ReadonlyArray<RunStep>;
  /** What the agent asks before using a tool and waits on the user's answer to, oldest first. */
  readonly approvals: ReadonlyArray<Approval>;
  /** The agent is compacting the conversation right now. */
  readonly compacting?: boolean;
  readonly reply?: string;
  readonly error?: string;
  readonly signedOut?: boolean | undefined;
  /** A request on its way to an agent that the server has not answered yet. */
  readonly sending?: Sending | undefined;
}

/** A request the board sent, before the server answers with its id. */
export interface Sending {
  readonly agent: AgentName;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
  /** The item's requests before it was sent; the one being sent is the request not among them. */
  readonly before: ReadonlyArray<string>;
}

export const NO_RUN: LiveRun = {
  subject: undefined,
  agent: undefined,
  status: "done",
  steps: [],
  approvals: [],
};

const append = (run: LiveRun, step: RunStep): LiveRun => ({ ...run, steps: [...run.steps, step] });

/** A run that just started on request `subject`, before anything streamed. */
const startedRun = (
  subject: string,
  agent: AgentName,
  { model, effort }: Pick<LiveRun, "model" | "effort">,
): LiveRun => ({ ...NO_RUN, subject, agent, model, effort, status: "running" });

/**
 * Fold one stream message into the run. The stream replays a run from its start whenever it
 * (re)connects, so `run` and `start` begin from scratch instead of appending to what is shown.
 */
export function reduceRun(run: LiveRun, message: RunMessage): LiveRun {
  switch (message.type) {
    case "run":
      return { ...NO_RUN, subject: message.subject, status: "running" };

    case "start":
      return startedRun(message.subject, message.agent, message);

    case "text":
      return append(run, { kind: "text", text: message.text });

    case "tool":
      return append(
        run,
        message.detail === undefined
          ? { kind: "tool", name: message.name }
          : { kind: "tool", name: message.name, detail: message.detail },
      );

    case "approval": {
      const { type: _, ...approval } = message;

      return { ...run, approvals: [...run.approvals, approval] };
    }

    case "approval-settled":
      return { ...run, approvals: run.approvals.filter(({ id }) => id !== message.id) };

    // Nothing waits on an answer once the run is over.
    case "done":
      return { ...run, status: "done", reply: message.reply, approvals: [] };

    case "stopped":
      return { ...run, status: "stopped", approvals: [] };

    case "error":
      return {
        ...run,
        status: "failed",
        error: message.error,
        signedOut: message.signedOut,
        approvals: [],
      };

    case "compaction":
      if (message.state === "running") return { ...run, compacting: true };

      return { ...(message.state === "done" ? append(run, COMPACTION) : run), compacting: false };
  }
}

/** Changes the run the chat shows, as React's `setState` does. */
export type OnRun = (update: (run: LiveRun) => LiveRun) => void;

/**
 * Mark a request as on its way. The board sees a new request before the server answers, while
 * the server still prepares the agent's context, so without this it would read as not sent. A
 * request to no agent, or one that will wait behind the run going now, starts nothing.
 */
export function sendingRun(run: LiveRun, item: ItemDetail, input: EditInput): LiveRun {
  const { agent, model, effort } = input;

  if (agent === "queue" || item.running || run.status === "running") return run;

  const before = item.doc.feedback.map((feedback) => feedback.id);

  return { ...run, sending: { agent, model, effort, before } };
}

/** Forget the request on its way, once the server answered or the send failed. */
export const settledRun = (run: LiveRun): LiveRun =>
  run.sending === undefined ? run : { ...run, sending: undefined };

/** The run a just-sent request starts, until the stream reports it. */
export function sentRun(run: LiveRun, receipt: EditReceipt, settings: ModelSettings): LiveRun {
  const { sent, feedbackId } = receipt;
  const request = receipt.item.doc.feedback.find((feedback) => feedback.id === feedbackId);

  // Sent to no agent, or lined up behind another run: nothing started yet.
  if (sent === "queue" || request === undefined || request.waiting !== undefined) {
    return settledRun(run);
  }

  // The stream got there first.
  if (run.subject === feedbackId) return settledRun(run);

  return startedRun(feedbackId, sent, settings);
}

/** The streamed run as a request shows it: its own, or the one it is on its way to start. */
export function liveFor(run: LiveRun, feedback: Feedback): Option.Option<LiveRun> {
  if (run.subject === feedback.id) return Option.some(run);

  const { sending } = run;

  if (sending === undefined || sending.before.includes(feedback.id)) return Option.none();

  // Lined up or already run: not the request on its way.
  if (feedback.waiting !== undefined || feedback.run !== undefined) return Option.none();

  return Option.some(startedRun(feedback.id, sending.agent, sending));
}

/** A finished run as the chat lays it out: the steps, then the reply under them. */
export interface ClosedRun {
  readonly steps: ReadonlyArray<RunStep>;
  readonly reply: Option.Option<string>;
}

/**
 * Split the reply out of the steps. The last text step usually is the reply; it is dropped from
 * the steps rather than the reply hidden, so the reply still shows when the steps are folded away.
 */
export function closingReply(
  steps: ReadonlyArray<RunStep>,
  reply: Option.Option<string>,
): ClosedRun {
  const text = Option.filter(
    Option.map(reply, (said) => said.trim()),
    (said) => said !== "",
  );

  if (Option.isNone(text)) return { steps, reply: text };

  const index = steps.findLastIndex((step) => step.kind === "text");
  const last = steps[index];
  const repeated = last?.kind === "text" && last.text.trim() === text.value;

  return { steps: repeated ? steps.toSpliced(index, 1) : steps, reply: text };
}

export type ToolStep = Extract<RunStep, { kind: "tool" }>;

/**
 * A stretch of a run as the chat lays it out: something the agent said, tool calls in a row, or
 * where it compacted the conversation.
 */
export type StepSegment =
  | { readonly kind: "text"; readonly key: number; readonly text: string }
  | { readonly kind: "tools"; readonly key: number; readonly tools: ReadonlyArray<ToolStep> }
  | { readonly kind: "compaction"; readonly key: number };

/**
 * Gather tool calls in a row, so a run reads as what the agent said with what it did in between.
 * A segment is keyed by its first step's position, which stays put while the run streams.
 */
export function groupSteps(steps: ReadonlyArray<RunStep>): StepSegment[] {
  // Built in place: each call joins the segment before it when that one holds calls too.
  const segments: Array<
    | { kind: "text"; key: number; text: string }
    | { kind: "tools"; key: number; tools: ToolStep[] }
    | { kind: "compaction"; key: number }
  > = [];

  for (const [key, step] of steps.entries()) {
    const last = segments.at(-1);

    // Blank text between two calls shows nothing, so it should not split them either.
    if (step.kind === "text") {
      if (step.text.trim() !== "") segments.push({ kind: "text", key, text: step.text });
    } else if (step.kind === "compaction") segments.push({ kind: "compaction", key });
    else if (last?.kind === "tools") last.tools.push(step);
    else segments.push({ kind: "tools", key, tools: [step] });
  }

  return segments;
}

/** What tool calls can do, in the order a summary of several names them. */
const TOOL_KIND_ORDER = ["read", "search", "edit", "command", "other"] as const;

export type ToolKind = (typeof TOOL_KIND_ORDER)[number];

/** Claude Code's tools, then the names Codex's events get; anything else is `other`. */
const TOOL_KINDS = new Map<string, ToolKind>([
  ["Read", "read"],
  ["NotebookRead", "read"],
  ["Glob", "search"],
  ["Grep", "search"],
  ["LS", "search"],
  ["WebSearch", "search"],
  ["WebFetch", "search"],
  ["Edit", "edit"],
  ["MultiEdit", "edit"],
  ["Write", "edit"],
  ["NotebookEdit", "edit"],
  ["Bash", "command"],
  ["BashOutput", "command"],
  ["shell", "command"],
  ["edit", "edit"],
]);

export const toolKind = (name: string): ToolKind => TOOL_KINDS.get(name) ?? "other";

export interface ToolCount {
  readonly kind: ToolKind;
  readonly count: number;
}

/** How many calls of each kind `tools` holds, in that order, leaving out the kinds it has none of. */
export function toolCounts(tools: ReadonlyArray<ToolStep>): ToolCount[] {
  return TOOL_KIND_ORDER.flatMap((kind) => {
    const count = tools.filter((tool) => toolKind(tool.name) === kind).length;

    return count === 0 ? [] : [{ kind, count }];
  });
}

/** One run as a message shows it, streamed or saved; a request not sent yet has no status. */
export interface RunView {
  readonly agent: Option.Option<AgentName>;
  readonly settings: NamedSettings;
  readonly status: Option.Option<AgentRun["status"]>;
  readonly running: boolean;
  /** The agent is compacting the conversation right now. */
  readonly compacting: boolean;
  readonly steps: ReadonlyArray<RunStep>;
  /** What the agent waits on the user's answer to; only a streamed run asks. */
  readonly approvals: ReadonlyArray<Approval>;
  readonly reply: Option.Option<string>;
  readonly error: Option.Option<string>;
  readonly signedOut: boolean;
}

/**
 * Where a run stands: the streamed one when it is about this message, else the saved one. A saved
 * run still marked running with no agent behind it (`alive` false) was cut off, by a server restart
 * say, so it shows as stopped. A saved run keeps no steps, only whether it compacted.
 */
export function runView(
  saved: AgentRun | undefined,
  live: Option.Option<LiveRun>,
  alive: boolean,
): RunView {
  const streamed = Option.getOrUndefined(live);
  const status = streamed?.status ?? saved?.status;
  const interrupted = streamed === undefined && status === "running" && !alive;
  const running = status === "running" && !interrupted;
  // A run streamed without a model ran on the default, whatever an older saved run used.
  const named = streamed ?? saved;

  return {
    agent: Option.fromUndefinedOr(streamed?.agent ?? saved?.agent),
    settings: { model: named?.model, effort: named?.effort },
    status: Option.fromUndefinedOr(interrupted ? "stopped" : status),
    running,
    compacting: running && streamed?.compacting === true,
    steps: streamed?.steps ?? (saved?.compacted === true ? [COMPACTION] : []),
    approvals: running ? (streamed?.approvals ?? []) : [],
    reply: Option.fromUndefinedOr(streamed?.reply ?? saved?.reply),
    error: Option.fromUndefinedOr(streamed?.error ?? saved?.error),
    signedOut: named?.signedOut === true,
  };
}
