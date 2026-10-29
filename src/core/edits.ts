import { Effect } from "effect";

import { restoreCode, restoreCodeFrom } from "./editCode.ts";
import { buildContext } from "./editContext.ts";
import { itemRel, keptFile, variantCodeDir } from "./editFiles.ts";
import { saveBefore, snapshotAfter } from "./editSnapshots.ts";
import { hasVersions, markKept, pendingVariants } from "./editVariants.ts";
import { InvalidRequest } from "./errors.ts";
import { recordMedia } from "./history.ts";
import {
  type Item,
  addFeedback,
  answerQuestions,
  findFeedback,
  getItem,
  mutateItem,
  resolveFeedback,
  updateFeedback,
  withDecision,
} from "./items.ts";
import type { AgentPick, EditContext, Feedback, FeedbackInput } from "./schema.ts";
import { nowIso } from "./time.ts";
import { Workspace } from "./workspace.ts";

export interface EditRequested {
  readonly item: Item;
  readonly feedback: Feedback;
  /** Context files that could not be made; the request stands without them. */
  readonly warnings: ReadonlyArray<string>;
}

/**
 * Record an edit request and prepare what the agent needs: the selected range as a clip, the
 * frame with the region drawn on it, and a snapshot of the media as it is now (the "before" side
 * of the comparison). A request without media is about the item as a whole, such as making its
 * first video. A request `waiting` for the board's agent gets its snapshot when its turn comes,
 * so it starts from what the requests before it left.
 */
export const requestEdit = Effect.fn("edits.requestEdit")(function* (
  id: string,
  input: FeedbackInput,
  waiting?: AgentPick,
) {
  const current = yield* getItem(id);
  const mediaName = input.media;
  const media = current.media.find((m) => m.name === mediaName);

  if (mediaName !== undefined && media === undefined) {
    return yield* new InvalidRequest({ message: `No media named ${mediaName} on ${id}` });
  }

  if (media === undefined && (input.timecode !== undefined || input.region !== undefined)) {
    return yield* new InvalidRequest({ message: "A range or box needs the media file it is on" });
  }

  const fresh = yield* addFeedback(id, input, waiting);
  const answered = yield* answerQuestions(fresh.item, fresh.feedback.id);
  const added = { item: answered, feedback: yield* findFeedback(answered, fresh.feedback.id) };
  const before = waiting === undefined ? yield* saveBefore(added.item, added.feedback) : undefined;

  if (media === undefined) {
    const result: EditRequested = { item: added.item, feedback: added.feedback, warnings: [] };

    return result;
  }

  const made = yield* buildContext(added.item, added.feedback, media.name, media.kind);
  const context: EditContext = { ...made.context, before };

  const item = yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, added.feedback.id, (entry) => ({ ...entry, context })),
  );

  const result: EditRequested = {
    item,
    feedback: yield* findFeedback(item, added.feedback.id),
    warnings: made.warnings,
  };

  return result;
});

/** Resolve a request and keep the result for comparison. Used by agents (MCP) and the runner. */
export const resolveEdit = Effect.fn("edits.resolveEdit")(function* (
  id: string,
  feedbackId: string,
  resolution: string,
) {
  yield* snapshotAfter(id, feedbackId);

  return yield* resolveFeedback(id, feedbackId, resolution);
});

/** The user keeps the result. */
export const approveEdit = Effect.fn("edits.approveEdit")(function* (
  id: string,
  feedbackId: string,
) {
  const item = yield* snapshotAfter(id, feedbackId);

  if (pendingVariants(yield* findFeedback(item, feedbackId))) {
    return yield* new InvalidRequest({ message: "Pick one of the versions, or keep none" });
  }

  const now = yield* nowIso;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => withDecision(entry, "approved", now)),
  );
});

/**
 * The user rolls the media, and the agent's code with it, back to how they were when the request was
 * made. A request's versions stay to switch to, until the item is done or exported.
 */
export const restoreBefore = Effect.fn("edits.restoreBefore")(function* (
  id: string,
  feedbackId: string,
) {
  const ws = yield* Workspace;
  const item = yield* snapshotAfter(id, feedbackId);
  const f = yield* findFeedback(item, feedbackId);
  const before = f.context?.before;

  // Versions not picked from, or a pick undone, already left the media as it was.
  const asItWas = hasVersions(f) && f.decision !== "approved";

  if (!asItWas) {
    if (f.media === undefined || before === undefined) {
      return yield* new InvalidRequest({ message: "This request has no saved before version" });
    }

    yield* ws.copy(`${item.dir}/${before}`, `${item.dir}/${f.media}`);
    yield* recordMedia(item, [{ media: f.media, file: before }], { cause: "restore", feedbackId });
  }

  yield* restoreCode(item, feedbackId);
  const now = yield* nowIso;

  return yield* mutateItem(id, (doc) =>
    updateFeedback(doc, id, feedbackId, (entry) => withDecision(entry, "restored", now)),
  );
});

/**
 * The user keeps one of the versions: it becomes the request's result. The others stay, so the
 * user can switch to one, until the item is done or exported.
 */
export const pickVariant = Effect.fn("edits.pickVariant")(function* (
  id: string,
  feedbackId: string,
  variantId: string,
) {
  const ws = yield* Workspace;
  const item = yield* snapshotAfter(id, feedbackId);
  const f = yield* findFeedback(item, feedbackId);

  if (!hasVersions(f)) {
    return yield* new InvalidRequest({ message: `No versions to pick from on ${feedbackId}` });
  }

  const chosen = f.variants.saved.find((v) => v.id === variantId);

  if (chosen === undefined) {
    return yield* new InvalidRequest({ message: `No version ${variantId} on ${feedbackId}` });
  }

  if (f.decision === "approved" && f.variants.picked === chosen.label) return item;

  const { media } = f.variants;
  const kept = keptFile(item, f.id, chosen.id, media);
  yield* ws.copy(`${item.dir}/${chosen.file}`, kept);
  yield* ws.copy(kept, `${item.dir}/${media}`);
  const file = itemRel(item, kept);
  yield* restoreCodeFrom(item, variantCodeDir(item, f.id, chosen.id));
  yield* recordMedia(item, [{ media, file, base: f.context?.before }], {
    cause: "edit",
    feedbackId,
  });

  return yield* markKept(item, feedbackId, chosen.label, file);
});
