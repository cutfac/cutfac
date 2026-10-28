import { Effect, Option } from "effect";

import { RunRegistry } from "../core/agentRun.ts";
import { requestEdit } from "../core/edits.ts";
import { waitingLine } from "../core/editWaiting.ts";
import { getItem } from "../core/items.ts";
import { which } from "../core/process.ts";
import type {
  AgentChoice,
  AgentName,
  AgentPick,
  FeedbackInput,
  ModelSettings,
} from "../core/schema.ts";
import { trustProblem } from "../core/workspaceTrust.ts";

interface Dispatch {
  readonly sent: AgentChoice;
  readonly warnings: ReadonlyArray<string>;
}

const queuedInstead = (reason: string): Dispatch => ({
  sent: "queue",
  warnings: [`${reason}; the request is queued instead`],
});

/** Why `agent` can't start in this workspace now, if it can't. */
const cannotStart = Effect.fnUntraced(function* (agent: AgentName) {
  if (Option.isNone(yield* which(agent))) return Option.some(`${agent} CLI not found on PATH`);

  return Option.fromUndefinedOr(yield* trustProblem(agent));
});

/** Start the agent on a recorded request, or leave it queued when the agent cannot start. */
const dispatch = Effect.fnUntraced(function* (itemId: string, feedbackId: string, pick: AgentPick) {
  const runs = yield* RunRegistry;
  const problem = yield* cannotStart(pick.agent);

  if (Option.isSome(problem)) return queuedInstead(problem.value);

  return yield* runs.start({ itemId, feedbackId, ...pick }).pipe(
    Effect.as<Dispatch>({ sent: pick.agent, warnings: [] }),
    Effect.catchTag("Conflict", (error) => Effect.succeed(queuedInstead(error.message))),
  );
});

/**
 * Record a request and hand it to `via`: now, or once the item's run and the requests waiting
 * before it are done. Requests on an item run in the order they were made.
 */
export const sendEdit = Effect.fnUntraced(function* (
  id: string,
  input: FeedbackInput,
  via: AgentChoice,
  settings: ModelSettings,
) {
  const runs = yield* RunRegistry;

  if (via === "queue") {
    const queued: Dispatch = { sent: "queue", warnings: [] };

    return { requested: yield* requestEdit(id, input), dispatched: queued };
  }

  const pick: AgentPick = { agent: via, ...settings };
  const busy = (yield* runs.isRunning(id)) || waitingLine((yield* getItem(id)).doc).length > 0;

  if (!busy) {
    const requested = yield* requestEdit(id, input);

    return { requested, dispatched: yield* dispatch(id, requested.feedback.id, pick) };
  }

  const problem = yield* cannotStart(via);

  if (Option.isSome(problem)) {
    return {
      requested: yield* requestEdit(id, input),
      dispatched: queuedInstead(problem.value),
    };
  }

  const waiting: Dispatch = { sent: via, warnings: [] };

  return { requested: yield* requestEdit(id, input, pick), dispatched: waiting };
});
