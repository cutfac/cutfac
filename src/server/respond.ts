import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

/** Every error a route can fail with carries a tag and a message for the board to show. */
interface Failure {
  readonly _tag: string;
  readonly message: string;
}

const STATUS_BY_TAG = new Map([
  ["NotFound", 404],
  ["InvalidRequest", 400],
  ["SchemaError", 400],
  ["MultipartError", 400],
  // Request bodies that are not JSON; route misses never reach the JSON routes.
  ["HttpServerError", 400],
  ["Conflict", 409],
  // The desktop app's free version made all of its videos; the board offers the paid plan.
  ["FreeLimitReached", 402],
  ["FetchFailed", 502],
]);

export const failureResponse = (error: Failure) => {
  const status = STATUS_BY_TAG.get(error._tag) ?? 500;

  const response = HttpServerResponse.jsonUnsafe(
    { error: error.message || error._tag },
    { status },
  );

  return status >= 500 ? Effect.as(Effect.logError(error), response) : Effect.succeed(response);
};

/** Encode a route's result as JSON, and any failure as `{ error }` with a matching status. */
const respond = <A, E extends Failure, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.flatMap((body) => HttpServerResponse.json(body)),
    Effect.catch(failureResponse),
  );

/** A JSON route: the handler's result as the body, its failure as `{ error }`. */
export const json = <A, E extends Failure, R>(
  method: "GET" | "POST" | "PATCH",
  path: HttpRouter.PathInput,
  handler: Effect.Effect<A, E, R>,
) => HttpRouter.route(method, path, respond(handler));

const IdQuery = Schema.Struct({ id: Schema.NonEmptyString });

export const queryId = Effect.map(
  HttpServerRequest.schemaSearchParams(IdQuery),
  (query) => query.id,
);

/** A route about the item or import named by `?id=`. */
export const withId = <A, E, R>(f: (id: string) => Effect.Effect<A, E, R>) =>
  Effect.flatMap(queryId, f);
