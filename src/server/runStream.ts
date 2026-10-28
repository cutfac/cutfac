import { Effect, Option, Schema, Stream } from "effect";
import type { HttpRouter } from "effect/http";

import { RunEvent } from "../core/agentParse.ts";
import type { Runs } from "../core/runRegistry.ts";
import { type Failure, queryId, raw } from "./respond.ts";
import { eventStream, sseEvent } from "./sse.ts";

const encodeRunEvent = Schema.encodeEffect(Schema.fromJsonString(RunEvent));

/**
 * The latest run on the queried key: a `run` event naming what it is about (an item's request, an
 * import's turn), its events so far, then live ones. `find` turns away keys that name nothing, so
 * a stray id cannot leave a channel behind.
 */
export const runStream = <I, R, E extends Failure, R2>(
  path: HttpRouter.PathInput,
  registry: Effect.Effect<Runs<I>, never, R>,
  find: (id: string) => Effect.Effect<unknown, E, R2>,
) =>
  raw(
    "GET",
    path,
    Effect.gen(function* () {
      const runs = yield* registry;
      const id = yield* queryId;
      yield* find(id);

      // Subscribe inside the stream so the subscription lives exactly as long as the response.
      const events = Stream.unwrap(
        Effect.map(runs.subscribe(id), (subscription) => {
          const head = Option.match(subscription.subject, {
            onNone: () => Stream.empty,
            onSome: (subject) => Stream.make(sseEvent("run", subject)),
          });

          const body = Stream.mapEffect(subscription.events, (event) =>
            Effect.map(encodeRunEvent(event), (data) => sseEvent("agent", data)),
          );

          return Stream.concat(head, body);
        }),
      );

      return eventStream(events);
    }),
  );
