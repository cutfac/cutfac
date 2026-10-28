import { Effect, Schema } from "effect";

/** A field that is filled in with `value` when a file leaves it out. */
export const withDefault = <S extends Schema.Constraint>(value: S["Encoded"]) =>
  Schema.withDecodingDefault<S>(Effect.succeed(value));

export const describe = (description: string) => ({ description });

export const Count = Schema.Finite.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0));

export const Url = Schema.String.check(
  Schema.makeFilter((s: string) => URL.canParse(s) || "Expected a URL", { title: "url" }),
);
