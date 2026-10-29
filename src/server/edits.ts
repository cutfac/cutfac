import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { agentBin } from "../core/agentCommand.ts";
import { RunRegistry } from "../core/agentRun.ts";
import { buildEditPrompt } from "../core/editPrompt.ts";
import { approveEdit, pickVariant, resolveEdit, restoreBefore } from "../core/edits.ts";
import { pruneVersions } from "../core/editVariants.ts";
import { cancelWaiting, rewordWaiting, waitingLine, waitingPick } from "../core/editWaiting.ts";
import { InvalidRequest } from "../core/errors.ts";
import { type Item, addFeedback, findFeedback, getItem } from "../core/items.ts";
import { AgentChoice, AgentName, FeedbackInput, ModelSettings } from "../core/schema.ts";
import { Workspace } from "../core/workspace.ts";
import { requireTrust } from "../core/workspaceTrust.ts";
import { workOn } from "../plan.ts";
import { trackUsage } from "../usageStats.ts";
import { defaultAgent } from "./agents.ts";
import { sendEdit } from "./dispatch.ts";
import { itemDetail } from "./items.ts";
import { json, queryId, withId } from "./respond.ts";
import { runStream } from "./runStream.ts";

const FeedbackQuery = Schema.Struct({
  id: Schema.NonEmptyString,
  feedbackId: Schema.NonEmptyString,
});

const FeedbackRef = Schema.Struct({ feedbackId: Schema.NonEmptyString });

const PickBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  variantId: Schema.NonEmptyString,
});

const ResolveBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  resolution: Schema.optional(Schema.String),
});

/** Read beside the FeedbackInput fields of the same body. */
const EditVia = Schema.Struct({ agent: Schema.optional(AgentChoice), ...ModelSettings.fields });

const RunBody = Schema.Struct({
  feedbackId: Schema.NonEmptyString,
  agent: Schema.optional(AgentName),
  ...ModelSettings.fields,
});

/** One waiting request, or every one on the item. */
const CancelBody = Schema.Struct({ feedbackId: Schema.optional(Schema.NonEmptyString) });

const RewordBody = Schema.Struct({ feedbackId: Schema.NonEmptyString, body: Schema.String });

const decodeEditVia = Schema.decodeUnknownEffect(EditVia);

const decodeFeedbackInput = Schema.decodeUnknownEffect(FeedbackInput);

const resolutionOf = (text: string | undefined) => text?.trim() || "Resolved in the web UI";

/**
 * Record an edit request with its context files, then start the agent headlessly (streamed on
 * /api/item/run), line it up behind the item's run, or leave it queued for copy-paste.
 */
const editRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const runs = yield* RunRegistry;
  const id = yield* queryId;

  yield* workOn(id);

  const request = yield* HttpServerRequest.HttpServerRequest;
  const body = yield* request.json;
  const { agent, ...settings } = yield* decodeEditVia(body);
  const input = yield* decodeFeedbackInput(body);
  const via = agent ?? ws.config.agent.default;

  // Requests take turns here, so each sees whether the one before it started or lined up.
  return yield* runs.exclusive(
    id,
    Effect.gen(function* () {
      const { requested, dispatched } = yield* sendEdit(id, input, via, settings);

      yield* trackUsage("edit_requested", { versions: input.variants ?? 1 });

      return {
        item: yield* itemDetail(requested.item),
        feedbackId: requested.feedback.id,
        sent: dispatched.sent,
        warnings: [...requested.warnings, ...dispatched.warnings],
        prompt: yield* buildEditPrompt(requested.item, requested.feedback),
      };
    }),
  );
});

/** Send a queued request to an agent. */
const runRoute = Effect.gen(function* () {
  const ws = yield* Workspace;
  const runs = yield* RunRegistry;
  const id = yield* queryId;

  yield* workOn(id);

  const body = yield* HttpServerRequest.schemaBodyJson(RunBody);
  const { feedbackId, agent = defaultAgent(ws), ...settings } = body;
  yield* agentBin(agent);
  yield* requireTrust(agent);
  yield* findFeedback(yield* getItem(id), feedbackId);
  yield* runs.exclusive(id, runs.start({ itemId: id, feedbackId, agent, ...settings }));

  return { ok: true };
});

/** Start the item's waiting line again, after a run on it failed or was stopped. */
const continueRoute = withId((id) =>
  Effect.gen(function* () {
    yield* workOn(id);

    const runs = yield* RunRegistry;

    return yield* runs.exclusive(
      id,
      Effect.gen(function* () {
        const first = waitingLine((yield* getItem(id)).doc)[0];

        if (first === undefined) {
          return yield* new InvalidRequest({ message: "No request is waiting on this item" });
        }

        yield* agentBin(first.waiting);
        yield* requireTrust(first.waiting);
        yield* runs.start({ itemId: id, feedbackId: first.id, ...waitingPick(first) });

        return { ok: true };
      }),
    );
  }),
);

const changeItem = <A, RD, E, R>(
  schema: Schema.ConstraintDecoder<A, RD>,
  change: (id: string, body: A) => Effect.Effect<Item, E, R>,
) =>
  withId((id) =>
    Effect.flatMap(HttpServerRequest.schemaBodyJson(schema), (body) =>
      Effect.flatMap(change(id, body), itemDetail),
    ),
  );

export const editRoutes = HttpRouter.addAll([
  json(
    "POST",
    "/api/item/feedback",
    changeItem(FeedbackInput, (id, input) =>
      Effect.map(addFeedback(id, input), (added) => added.item),
    ),
  ),
  json(
    "POST",
    "/api/item/feedback/resolve",
    changeItem(ResolveBody, (id, body) =>
      resolveEdit(id, body.feedbackId, resolutionOf(body.resolution)),
    ),
  ),
  json("POST", "/api/item/edit", editRoute),
  json("POST", "/api/item/edit/run", runRoute),
  json("POST", "/api/item/edit/continue", continueRoute),
  json(
    "POST",
    "/api/item/edit/cancel",
    changeItem(CancelBody, (id, body) => cancelWaiting(id, body.feedbackId)),
  ),
  json(
    "POST",
    "/api/item/edit/reword",
    changeItem(RewordBody, (id, body) => rewordWaiting(id, body.feedbackId, body.body)),
  ),
  json(
    "POST",
    "/api/item/edit/stop",
    withId((id) =>
      Effect.map(
        Effect.flatMap(RunRegistry, (runs) => runs.stop(id)),
        (stopped) => ({ ok: true, stopped }),
      ),
    ),
  ),
  json(
    "GET",
    "/api/item/edit/prompt",
    Effect.gen(function* () {
      const query = yield* HttpServerRequest.schemaSearchParams(FeedbackQuery);
      const item = yield* getItem(query.id);
      const feedback = yield* findFeedback(item, query.feedbackId);

      return { prompt: yield* buildEditPrompt(item, feedback) };
    }),
  ),
  json(
    "POST",
    "/api/item/edit/approve",
    changeItem(FeedbackRef, (id, body) => approveEdit(id, body.feedbackId)),
  ),
  json(
    "POST",
    "/api/item/edit/pick",
    changeItem(PickBody, (id, body) =>
      pickVariant(id, body.feedbackId, body.variantId).pipe(
        Effect.tap(() => trackUsage("take_kept")),
      ),
    ),
  ),
  json(
    "POST",
    "/api/item/edit/restore",
    changeItem(FeedbackRef, (id, body) => restoreBefore(id, body.feedbackId)),
  ),
  // Exporting is the end of comparing, so the versions not kept go.
  json(
    "POST",
    "/api/item/edit/prune",
    withId((id) => Effect.flatMap(pruneVersions(id), itemDetail)),
  ),
  runStream("/api/item/run", RunRegistry, getItem),
]);
