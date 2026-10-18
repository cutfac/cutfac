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

export type RunStep =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "tool"; readonly name: string; readonly detail?: string };

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
  readonly reply?: string;
  readonly error?: string;
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

    case "done":
      return { ...run, status: "done", reply: message.reply };

    case "stopped":
      return { ...run, status: "stopped" };

    case "error":
      return { ...run, status: "failed", error: message.error };
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
export function liveFor(run: LiveRun, feedback: Feedback): LiveRun | undefined {
  if (run.subject === feedback.id) return run;

  const { sending } = run;

  if (sending === undefined || sending.before.includes(feedback.id)) return undefined;

  // Lined up or already run: not the request on its way.
  if (feedback.waiting !== undefined || feedback.run !== undefined) return undefined;

  return startedRun(feedback.id, sending.agent, sending);
}

/** A finished run as the chat lays it out: the steps, then the reply under them. */
export interface ClosedRun {
  readonly steps: ReadonlyArray<RunStep>;
  readonly reply: string | undefined;
}

/**
 * Split the reply out of the steps. The last text step usually is the reply; it is dropped from
 * the steps rather than the reply hidden, so the reply still shows when the steps are folded away.
 */
export function closingReply(steps: ReadonlyArray<RunStep>, reply: string | undefined): ClosedRun {
  const text = reply?.trim();

  if (text === undefined || text === "") return { steps, reply: undefined };

  const index = steps.findLastIndex((step) => step.kind === "text");
  const last = steps[index];
  const repeated = last?.kind === "text" && last.text.trim() === text;

  return { steps: repeated ? steps.toSpliced(index, 1) : steps, reply: text };
}

/** One run as a message shows it, streamed or saved. */
export interface RunView {
  readonly agent: AgentName | undefined;
  readonly model: string | undefined;
  readonly effort: string | undefined;
  readonly status: AgentRun["status"] | undefined;
  readonly running: boolean;
  readonly steps: ReadonlyArray<RunStep>;
  readonly reply: string | undefined;
  readonly error: string | undefined;
}

/**
 * Where a run stands: the streamed one when it is about this message, else the saved one. A saved
 * run still marked running with no agent behind it (`alive` false) was cut off, by a server restart
 * say, so it shows as stopped.
 */
export function runView(
  saved: AgentRun | undefined,
  live: LiveRun | undefined,
  alive: boolean,
): RunView {
  const status = live?.status ?? saved?.status;
  const interrupted = live === undefined && status === "running" && !alive;

  return {
    agent: live?.agent ?? saved?.agent,
    // A run streamed without a model ran on the default, whatever an older saved run used.
    model: live === undefined ? saved?.model : live.model,
    effort: live === undefined ? saved?.effort : live.effort,
    status: interrupted ? "stopped" : status,
    running: status === "running" && !interrupted,
    steps: live?.steps ?? [],
    reply: live?.reply ?? saved?.reply,
    error: live?.error ?? saved?.error,
  };
}
