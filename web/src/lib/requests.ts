import type { Feedback, ItemDetail, Variant } from "../api.ts";
import { liveFor, runView, type LiveRun, type RunView } from "./run.ts";

/** The item's requests in the order they were made, which is how the chat numbers them. */
export const inOrder = (item: ItemDetail) =>
  item.doc.feedback.toSorted((a, b) => a.at.localeCompare(b.at));

export const isWaiting = (feedback: Feedback) =>
  feedback.waiting !== undefined && feedback.status === "open";

/** The requests lined up for the board's agent, in the order they will run. */
export const waitingLine = (requests: ReadonlyArray<Feedback>) => requests.filter(isWaiting);

/**
 * Requests wait and nothing runs: the run before them failed, was stopped, or was cut off. Right
 * after a run finishes its work the next one is about to start, so the line is moving, not held.
 */
export function linePaused(item: ItemDetail, live: LiveRun): boolean {
  if (item.running || live.status === "running" || !item.doc.feedback.some(isWaiting)) return false;

  return live.subject === undefined || live.status !== "done";
}

/** The most versions one request can ask for; the server holds the same limit. */
export const MAX_VARIANTS = 4;

/** The versions the agent saved for the user to pick from, until one is kept or none. */
export const versionsOf = (feedback: Feedback): ReadonlyArray<Variant> =>
  feedback.decision === undefined ? (feedback.variants?.saved ?? []) : [];

/** The media a request's versions are of. */
export const versionsMedia = (feedback: Feedback): string | undefined =>
  feedback.variants?.media ?? feedback.media;

/**
 * The media changed since the request's run began, or versions of it were saved: the agent wrote a
 * result that waits for a decision. A request that waited counts from when its turn came, not from
 * when it was made.
 */
export function hasResult(
  item: Pick<ItemDetail, "media">,
  feedback: Feedback,
  running: boolean,
): boolean {
  const context = feedback.context;

  if (running || feedback.decision !== undefined) return false;

  if (versionsOf(feedback).length > 0) return true;

  if (context?.before === undefined) return false;

  if (context.after !== undefined) return true;

  const current = item.media.find((media) => media.name === feedback.media);

  return current !== undefined && current.mtime > Date.parse(feedback.baseline ?? feedback.at);
}

/**
 * The agent's run ended with the request still open and nothing to look at: it asked the user and
 * waits for the answer, which goes to it as the next request.
 */
export const asksUser = (
  item: Pick<ItemDetail, "media">,
  feedback: Feedback,
  run: Pick<RunView, "status" | "running">,
) =>
  feedback.status === "open" &&
  feedback.decision === undefined &&
  !run.running &&
  run.status === "done" &&
  !hasResult(item, feedback, false);

/**
 * How the chat offers to run an open request: to send it, when nothing ran it yet; to run it
 * again, after a run that failed or was stopped; or not at all, while it runs, after a run that
 * finished, or once its result came in, which the user's own agent can also bring.
 */
export function runOffer(
  open: boolean,
  run: Pick<RunView, "status" | "running">,
  result: boolean,
): "send" | "retry" | undefined {
  if (!open || result || run.running || run.status === "done") return undefined;

  return run.status === undefined ? "send" : "retry";
}

/** Where a request still in play stands, as its pin on the frame shows it. */
export type PinState = "working" | "waiting" | "halted" | "review";

/** A request still in play, numbered as the chat numbers it. */
export interface Pin {
  readonly feedback: Feedback;
  readonly number: number;
  readonly state: PinState;
}

function pinState(item: ItemDetail, feedback: Feedback, live: LiveRun): PinState | undefined {
  const run = runView(feedback.run, liveFor(live, feedback), item.running);

  if (run.running) return "working";

  if (isWaiting(feedback)) return "waiting";

  if (hasResult(item, feedback, false)) return "review";

  const open = feedback.status === "open" && feedback.decision === undefined;

  if (open && (run.status === "failed" || run.status === "stopped")) return "halted";

  return undefined;
}

/** The requests on `media` still in play: working, waiting, halted, or waiting for a decision. */
export function pinsOn(item: ItemDetail, media: string | undefined, live: LiveRun): Pin[] {
  return inOrder(item).flatMap((feedback, index) => {
    const state = feedback.media === media ? pinState(item, feedback, live) : undefined;

    return state === undefined ? [] : [{ feedback, number: index + 1, state }];
  });
}
