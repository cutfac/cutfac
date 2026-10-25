import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import { ApprovalAnswer } from "../core/approval.ts";
import { json, withId } from "./respond.ts";

/** The user's answer to a request the agent working on the item put to the board. */
const AnswerBody = Schema.Struct({ request: Schema.NonEmptyString, answer: ApprovalAnswer });

/**
 * What the board answers when the agent asks before using a tool. `answered` is false once the
 * request is settled, as by the agent taking it back or a stop, which the run's stream says too.
 */
export const approvalRoutes = HttpRouter.addAll([
  json(
    "POST",
    "/api/item/edit/approval",
    withId((id) =>
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(AnswerBody);
        const runs = yield* RunRegistry;

        return { answered: yield* runs.answer(id, body.request, body.answer) };
      }),
    ),
  ),
]);
