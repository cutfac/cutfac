import { DateTime, Effect, Option } from "effect";

export const nowIso: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);

/** Epoch milliseconds of an ISO timestamp; 0 if it does not parse. */
export const isoMillis = (iso: string) =>
  Option.match(DateTime.make(iso), { onNone: () => 0, onSome: DateTime.toEpochMillis });
