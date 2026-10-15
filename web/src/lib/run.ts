import type { AgentName, AgentRun, RunMessage } from "../api.ts";

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
}

export const NO_RUN: LiveRun = {
  subject: undefined,
  agent: undefined,
  status: "done",
  steps: [],
};

const append = (run: LiveRun, step: RunStep): LiveRun => ({ ...run, steps: [...run.steps, step] });

/**
 * Fold one stream message into the run. The stream replays a run from its start whenever it
 * (re)connects, so `run` and `start` begin from scratch instead of appending to what is shown.
 */
export function reduceRun(run: LiveRun, message: RunMessage): LiveRun {
  switch (message.type) {
    case "run":
      return { ...NO_RUN, subject: message.subject, status: "running" };

    case "start":
      return {
        ...NO_RUN,
        subject: message.subject,
        agent: message.agent,
        model: message.model,
        effort: message.effort,
        status: "running",
      };

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
