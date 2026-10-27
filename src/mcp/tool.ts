import { Effect, Predicate, Schema, SchemaGetter } from "effect";
import { Tool } from "effect/ai";

import {
  CommandFailed,
  Conflict,
  FetchFailed,
  InvalidRequest,
  NotFound,
  WorkspaceError,
} from "../core/errors.ts";
import { answeredWithError } from "../core/logFile.ts";
import { FreeLimitReached } from "../plan.ts";

export const describe = (description: string) => ({ description });

/** Every error the core raises. Each carries a message, which the agent sees as the tool error. */
const CutfacFailure = Schema.Union([
  WorkspaceError,
  NotFound,
  InvalidRequest,
  Conflict,
  CommandFailed,
  FetchFailed,
  FreeLimitReached,
]);

const withoutUndefined = <A>(value: A): A => {
  if (Array.isArray(value)) {
    // SAFETY: each element keeps its own type, its undefined fields left out.
    return value.map(withoutUndefined) as A;
  }

  if (!Predicate.isObject(value)) return value;

  // SAFETY: a field left out reads as the undefined it held, so the object still fits `A`.
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, field]) =>
      field === undefined ? [] : [[key, withoutUndefined(field)]],
    ),
  ) as A;
};

// The MCP result check rejects undefined, and the agent would see only an internal error.
const asJson = <S extends Schema.Constraint>(success: S) =>
  Schema.encode<S>({
    decode: SchemaGetter.passthrough(),
    encode: SchemaGetter.transform(withoutUndefined),
  })(success);

/** A Cutfac MCP tool, with the hints a client shows the user before it runs. */
export const tool = <
  const Name extends string,
  Parameters extends Schema.Constraint = typeof Tool.EmptyParams,
  Success extends Schema.Constraint = typeof Schema.Void,
>(
  name: Name,
  options: {
    readonly description: string;
    readonly parameters?: Parameters | undefined;
    readonly success: Success;
    /** Only reads the workspace. */
    readonly readonly?: boolean | undefined;
    /** Replaces something the agent or user wrote before, rather than adding to it. */
    readonly overwrites?: boolean | undefined;
    /** Calling it again with the same arguments changes nothing further. */
    readonly idempotent?: boolean | undefined;
    /** Reaches the network (store listings, yt-dlp downloads). */
    readonly network?: boolean | undefined;
  },
) =>
  Tool.make(name, {
    description: options.description,
    parameters: options.parameters,
    success: asJson(options.success),
    failure: CutfacFailure,
  })
    .annotate(Tool.Readonly, options.readonly === true)
    .annotate(Tool.Destructive, options.overwrites === true)
    .annotate(Tool.Idempotent, options.readonly === true || options.idempotent === true)
    .annotate(Tool.OpenWorld, options.network === true);

/**
 * Marks a tool call that fails in the app's log, with the message the agent sees. The call itself
 * ends well, as the error goes back to the agent, so the log would otherwise not say.
 */
export const logFailure = <A, E extends { readonly message: string }, R>(
  call: Effect.Effect<A, E, R>,
) => Effect.tapError(call, (error) => answeredWithError(error.message));
