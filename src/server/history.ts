import { Effect, Schema, Semaphore } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import { Conflict } from "../core/errors.ts";
import { goTo, redo, restoreVersion, undo, updateDetails } from "../core/history.ts";
import type { Item } from "../core/items.ts";
import { ItemPatch } from "../core/schema.ts";
import { itemDetail } from "./items.ts";
import { json, withId } from "./respond.ts";

const GoToBody = Schema.Struct({ entryId: Schema.optional(Schema.NonEmptyString) });

const VersionBody = Schema.Struct({ versionId: Schema.NonEmptyString });

/**
 * Changes that go through the item's undo history. They run one at a time, and undo waits until
 * no agent is working on the item, since the agent may be editing the same files.
 */
export const historyRoutes = HttpRouter.addAll(
  Effect.map(Semaphore.make(1), (lock) => {
    const recorded = <E, R>(change: (id: string) => Effect.Effect<Item, E, R>) =>
      withId((id) => lock.withPermits(1)(Effect.flatMap(change(id), itemDetail)));

    const travel = <E, R>(change: (id: string) => Effect.Effect<Item, E, R>) =>
      recorded((id) =>
        Effect.gen(function* () {
          const runs = yield* RunRegistry;

          if (yield* runs.isRunning(id)) {
            return yield* new Conflict({
              message: "An agent is working on this item; wait for it or stop it first",
            });
          }

          return yield* change(id);
        }),
      );

    return [
      json(
        "PATCH",
        "/api/item",
        recorded((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(ItemPatch), (patch) =>
            updateDetails(id, patch),
          ),
        ),
      ),
      json("POST", "/api/item/history/undo", travel(undo)),
      json("POST", "/api/item/history/redo", travel(redo)),
      json(
        "POST",
        "/api/item/history/goto",
        travel((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(GoToBody), (body) =>
            goTo(id, body.entryId),
          ),
        ),
      ),
      json(
        "POST",
        "/api/item/history/version",
        travel((id) =>
          Effect.flatMap(HttpServerRequest.schemaBodyJson(VersionBody), (body) =>
            restoreVersion(id, body.versionId),
          ),
        ),
      ),
    ];
  }),
);
