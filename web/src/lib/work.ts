import type { Feedback, ItemSummary } from "../api.ts";
import type { Attention } from "../desktop.ts";
import { renderShare, type RenderState } from "./render.ts";
import { hasResult, versionsOf } from "./requests.ts";
import { runView } from "./run.ts";

/**
 * Where an item stands for the user, as its gallery tile says it: something waits for them, an
 * agent or a render is at work, a result came in, or nothing goes on.
 */
export type ItemWork =
  /** The agent waits for the user to let it use a tool. */
  | { readonly kind: "approval"; readonly request?: Feedback }
  /** Versions wait for the user to keep one. */
  | { readonly kind: "versions"; readonly request: Feedback; readonly labels: string[] }
  /** A run failed or was stopped with its request still open. */
  | { readonly kind: "halted"; readonly request: Feedback }
  /** A render goes on; `share` is how much of it is done, from 0 to 1, when it can tell. */
  | {
      readonly kind: "rendering";
      readonly label?: string | undefined;
      readonly share?: number | undefined;
    }
  /** The last render failed, and the user hasn't opened the item since. */
  | { readonly kind: "renderFailed"; readonly label?: string | undefined }
  /** An agent works on a request. */
  | { readonly kind: "working"; readonly request?: Feedback }
  /** The agent changed the media, and it waits to be looked at. */
  | { readonly kind: "result"; readonly request: Feedback }
  | { readonly kind: "quiet" };

const runOf = (item: ItemSummary, feedback: Feedback) =>
  runView(feedback.run, undefined, item.running);

/** The request the item's agent works on, when the board started the run. */
const atWork = (item: ItemSummary) => {
  const request = item.requests.find((feedback) => feedback.run?.status === "running");

  return request === undefined ? {} : { request };
};

const halted = (item: ItemSummary, feedback: Feedback) => {
  const { status } = runOf(item, feedback);

  return (
    feedback.status === "open" &&
    feedback.decision === undefined &&
    (status === "failed" || status === "stopped")
  );
};

/**
 * What the item's tile says, the most pressing first: what waits for the user, then work. `seen`
 * says whether the user already looked at a failed render.
 */
export function itemWork(
  item: ItemSummary,
  seen: (render: RenderState) => boolean = () => false,
): ItemWork {
  const { requests, render } = item;

  // The agent can't go on until the user answers, so this comes before everything.
  if (item.running && item.approvals > 0) return { kind: "approval", ...atWork(item) };

  for (const request of requests) {
    // The agent may still be making more of them; they wait for the user once its run ends.
    if (runOf(item, request).running) continue;

    const labels = versionsOf(request).map((variant) => variant.label);

    if (labels.length > 0) return { kind: "versions", request, labels };
  }

  const stuck = requests.find((request) => halted(item, request));

  if (stuck !== undefined) return { kind: "halted", request: stuck };

  if (render?.status === "running") {
    return { kind: "rendering", label: render.label, share: renderShare(render) };
  }

  if (item.running) return { kind: "working", ...atWork(item) };

  if (render?.status === "failed" && !seen(render)) {
    return { kind: "renderFailed", label: render.label };
  }

  const done = requests.find((request) => hasResult(item, request, false));

  return done === undefined ? { kind: "quiet" } : { kind: "result", request: done };
}

/** Nothing goes on until the user answers the agent, picks a version or sends the request again. */
export const needsYou = (work: ItemWork) =>
  work.kind === "approval" ||
  work.kind === "versions" ||
  work.kind === "halted" ||
  work.kind === "renderFailed";

export const isBusy = (work: ItemWork) => work.kind === "rendering" || work.kind === "working";

const RANK: Record<ItemWork["kind"], number> = {
  approval: 0,
  versions: 1,
  halted: 1,
  renderFailed: 1,
  rendering: 2,
  working: 2,
  result: 3,
  quiet: 4,
};

/**
 * The gallery's order: an agent held up on the user, then the rest of what waits for them, then
 * work going on, then the rest by change.
 */
export function byWork<T extends { readonly item: ItemSummary; readonly work: ItemWork }>(
  tiles: ReadonlyArray<T>,
): T[] {
  return tiles.toSorted(
    (a, b) => RANK[a.work.kind] - RANK[b.work.kind] || b.item.updatedAt - a.item.updatedAt,
  );
}

/** Finished work never asks for the user, so it stays on the board. */
const unfinished = (item: ItemSummary) => item.status !== "done" && item.status !== "archived";

/** The videos still in progress, in the gallery's order, as the sidebar lists them. */
export const inProgress = (
  items: ReadonlyArray<ItemSummary>,
  seen?: (render: RenderState) => boolean,
) =>
  byWork(items.flatMap((item) => (unfinished(item) ? [{ item, work: itemWork(item, seen) }] : [])));

/** How many videos wait for the user, finished ones too: versions there still need picking. */
export const waitingCount = (
  items: ReadonlyArray<ItemSummary>,
  seen?: (render: RenderState) => boolean,
) => items.filter((item) => needsYou(itemWork(item, seen))).length;

/** What waits for the user, for the desktop app to tell them while they are elsewhere. */
export const attention = (
  items: ReadonlyArray<ItemSummary>,
  seen?: (render: RenderState) => boolean,
): Attention => ({
  waiting: waitingCount(items, seen),
  asking: items.flatMap((item) =>
    itemWork(item, seen).kind === "approval" ? [{ id: item.id, title: item.title }] : [],
  ),
});
