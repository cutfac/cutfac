import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { RunRegistry } from "../core/agentRun.ts";
import { Conflict } from "../core/errors.ts";
import { redo, restoreVersion, undo, updateDetails } from "../core/history.ts";
import type { Item } from "../core/items.ts";
import { ItemPatch } from "../core/schema.ts";
import { itemDetail } from "./items.ts";
import { json, withId } from "./respond.ts";

const VersionBody = Schema.Struct({ versionId: Schema.NonEmptyString });

const recorded = <E, R>(change: (id: string) => Effect.Effect<Item, E, R>) =>
  withId((id) => Effect.flatMap(change(id), itemDetail));

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

/**
 * Changes that go through the item's undo history. Undo waits until no agent is working on the
 * item, since the agent may be editing the same files.
 */
export const historyRoutes = HttpRouter.addAll([
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
    "/api/item/history/version",
    travel((id) =>
      Effect.flatMap(HttpServerRequest.schemaBodyJson(VersionBody), (body) =>
        restoreVersion(id, body.versionId),
      ),
    ),
  ),
]);
