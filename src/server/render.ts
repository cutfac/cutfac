import { Effect, Stream } from "effect";
import { HttpRouter } from "effect/http";

import { getItem } from "../core/items.ts";
import { readRender, requestStop } from "../core/render.ts";
import { Workspace } from "../core/workspace.ts";
import { failureResponse, json, withId } from "./respond.ts";
import { eventStream, sseEvent } from "./sse.ts";

/**
 * How often the board's stream looks at the item's render. The agent's MCP server runs it and
 * saves where it is twice a second, so this keeps up without reading the file more than that.
 */
const POLL_EVERY = "500 millis";

/**
 * The item's latest render as it changes: a `render` event with it as JSON, or `null` while the
 * item has none.
 */
const renderStream = withId((id) =>
  Effect.gen(function* () {
    yield* getItem(id);
    const ws = yield* Workspace;

    return eventStream(
      Stream.tick(POLL_EVERY).pipe(
        Stream.mapEffect(() => Effect.provideService(readRender(id), Workspace, ws)),
        Stream.map((state) => JSON.stringify(state ?? null)),
        Stream.changes,
        Stream.map((data) => sseEvent("render", data)),
      ),
    );
  }),
);

/** Renders the agents run, which the board follows beside the preview and can stop. */
export const renderRoutes = HttpRouter.addAll([
  HttpRouter.route("GET", "/api/item/render", Effect.catch(renderStream, failureResponse)),
  json(
    "POST",
    "/api/item/render/stop",
    withId((id) =>
      Effect.andThen(
        requestStop(id),
        Effect.map(readRender(id), (state) => state ?? null),
      ),
    ),
  ),
]);
