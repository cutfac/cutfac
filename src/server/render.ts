import { Effect, Option, Stream } from "effect";
import { HttpRouter } from "effect/http";

import { getItem } from "../core/items.ts";
import { readRender, RENDERS_DIR, requestStop, runningRenders } from "../core/render.ts";
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
        Stream.map((state) => JSON.stringify(Option.getOrNull(state))),
        Stream.changes,
        Stream.map((data) => sseEvent("render", data)),
      ),
    );
  }),
);

/**
 * A `change` event when a render starts or ends. Render files sit where the file watcher does not
 * look, so the gallery would otherwise hear of a render only after it is done.
 */
export const renderChanges = Effect.map(Workspace, (ws) =>
  Stream.tick("1 second").pipe(
    // A look that fails waits for the next tick instead of ending the stream.
    Stream.mapEffect(() => Effect.provideService(Effect.option(runningRenders()), Workspace, ws)),
    Stream.filter(Option.isSome),
    Stream.map((items) => items.value.join("\n")),
    Stream.changes,
    Stream.drop(1),
    Stream.map(() => sseEvent("change", RENDERS_DIR)),
  ),
);

/** Renders the agents run, which the board follows beside the preview and can stop. */
export const renderRoutes = HttpRouter.addAll([
  HttpRouter.route("GET", "/api/item/render", Effect.catch(renderStream, failureResponse)),
  json(
    "POST",
    "/api/item/render/stop",
    withId((id) => Effect.andThen(requestStop(id), Effect.map(readRender(id), Option.getOrNull))),
  ),
]);
