import { Effect, Schema } from "effect";

export class UntrustedSender extends Schema.TaggedError<UntrustedSender>()("UntrustedSender", {
  message: Schema.String,
}) {}

export class UnknownInput extends Schema.TaggedError<UnknownInput>()("UnknownInput", {
  message: Schema.String,
}) {}

export type Decodable = Schema.Top & { readonly DecodingServices: never };

/** What a channel takes from a page, and what to call it when it doesn't decode. */
export interface Input<S extends Decodable> {
  readonly schema: S;
  readonly what: string;
}

/** For a channel that takes nothing, or decodes what it takes itself. */
export const ANY_INPUT: Input<typeof Schema.Unknown> = { schema: Schema.Unknown, what: "input" };

/**
 * A page's call on `channel`: refused unless `trusted` says the page is one of the app's own and
 * its input decodes, then answered by `respond`. It runs as a span named after the channel, so a
 * call that fails reaches the app's log and error reports.
 */
export const ipcCall =
  <Event, S extends Decodable, A, E, R>(
    channel: string,
    trusted: (event: Event) => boolean,
    input: Input<S>,
    respond: (value: S["Type"], event: Event) => Effect.Effect<A, E, R>,
  ) =>
  (event: Event, raw: S["Encoded"]) =>
    Effect.gen(function* () {
      if (!trusted(event)) return yield* new UntrustedSender({ message: "Untrusted IPC sender" });

      const value = yield* Schema.decodeUnknownEffect(input.schema)(raw).pipe(
        Effect.mapError(() => new UnknownInput({ message: `Unknown ${input.what}` })),
      );

      return yield* respond(value, event);
    }).pipe(Effect.withSpan(`ipc ${channel}`));
