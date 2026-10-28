import { Effect } from "effect";

import { editDir } from "./editFiles.ts";
import { saveBefore } from "./editSnapshots.ts";
import { InvalidRequest, type NotFound } from "./errors.ts";
import { findFeedback, getItem, mutateItem, updateFeedback } from "./items.ts";
import type { AgentName, AgentPick, Feedback, ItemDoc } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/** A request lined up for the board's agent. */
export type Waiting = Feedback & { readonly waiting: AgentName };

export const isWaiting = (f: Feedback): f is Waiting =>
  f.waiting !== undefined && f.status === "open";

/** The agent, model, and effort a waiting request was sent to. */
export const waitingPick = (f: Waiting): AgentPick => ({
  agent: f.waiting,
  model: f.model,
  effort: f.effort,
});

/** The requests waiting for the board's agent on an item, in the order they were made. */
export const waitingLine = (doc: ItemDoc): ReadonlyArray<Waiting> => doc.feedback.filter(isWaiting);

/**
 * Ready a request for its run. One that waited for others on the item leaves the line, so it can
 * no longer be reworded or cancelled, and starts from what they left: the media is saved as its
 * "before" side now, and its changes count from now.
 */
export const beginEdit = Effect.fn("edits.beginEdit")(function* (id: string, feedbackId: string) {
  const item = yield* getItem(id);
  const f = yield* findFeedback(item, feedbackId);

  if (f.waiting === undefined) return { item, feedback: f };

  const baseline = yield* nowIso;
  const before = yield* saveBefore(item, f);

  const next = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => ({
      ...entry,
      waiting: undefined,
      model: undefined,
      effort: undefined,
      baseline,
      context: before === undefined ? entry.context : { ...entry.context, before },
    })),
  );

  return { item: next, feedback: yield* findFeedback(next, feedbackId) };
});

/** Change what a request still waiting for its turn asks for. */
export const rewordWaiting = Effect.fn("edits.rewordWaiting")(function* (
  id: string,
  feedbackId: string,
  body: string,
) {
  const text = body.trim();

  if (text === "") return yield* new InvalidRequest({ message: "A request needs a message" });

  return yield* mutateItem(id, (doc): Effect.Effect<ItemDoc, InvalidRequest | NotFound> =>
    doc.feedback.some((f) => f.id === feedbackId && isWaiting(f))
      ? updateFeedback(doc, id, feedbackId, (entry) => ({ ...entry, body: text }))
      : Effect.fail(new InvalidRequest({ message: "Only a waiting request can be changed" })),
  );
});

/**
 * Take requests out of the item's waiting line: the one named, or all of them. They never ran, so
 * they go, with the files made for them.
 */
export const cancelWaiting = Effect.fn("edits.cancelWaiting")(function* (
  id: string,
  feedbackId?: string,
) {
  const ws = yield* Workspace;

  const cancelled = (f: Feedback) =>
    isWaiting(f) && (feedbackId === undefined || f.id === feedbackId);

  const { doc } = yield* getItem(id);

  if (feedbackId !== undefined && !doc.feedback.some(cancelled)) {
    return yield* new InvalidRequest({ message: "Only a waiting request can be cancelled" });
  }

  // One may have started since it was read; it stays.
  const next = yield* mutateItem(id, (current) =>
    Effect.succeed({ ...current, feedback: current.feedback.filter((f) => !cancelled(f)) }),
  );

  const kept = new Set(next.doc.feedback.map((f) => f.id));
  const gone = doc.feedback.filter((f) => cancelled(f) && !kept.has(f.id));
  yield* Effect.forEach(gone, (f) => ws.remove(editDir(next, f.id)), { discard: true });

  return next;
});
