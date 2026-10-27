import { Effect, Predicate, Schema } from "effect";

export const isJsonObject = (value: Schema.Json | undefined): value is Schema.JsonObject =>
  Predicate.isObject(value) && !Array.isArray(value);

export const lenient = <S extends Schema.Top>(schema: S) =>
  Schema.optionalKey(schema.pipe(Schema.catchDecoding(() => Effect.succeedNone)));

/** Null, `[]` and `{}`, which turn nothing on. */
export const isEmptyJson = (value: Schema.Json) =>
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (isJsonObject(value) && Object.keys(value).length === 0);

/** `store` with `value` at `path`, keeping everything else as it was. */
export function setAt(
  store: Schema.JsonObject,
  [key, ...rest]: ReadonlyArray<string>,
  value: Schema.Json,
): Schema.JsonObject {
  if (key === undefined) return store;
  const inner = store[key];

  return {
    ...store,
    [key]: rest.length === 0 ? value : setAt(isJsonObject(inner) ? inner : {}, rest, value),
  };
}

/** Code-unit order, the same on every machine, unlike a locale's. */
export const byName =
  <A>(name: (a: A) => string) =>
  (a: A, b: A) => {
    const [x, y] = [name(a), name(b)];

    return x < y ? -1 : x > y ? 1 : 0;
  };

/** `value` with every object's keys in order, so the same settings always read the same. */
export const canonicalJson = (value: Schema.Json): Schema.Json => {
  if (Array.isArray(value)) return value.map(canonicalJson);

  if (!isJsonObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(byName(([key]) => key))
      .map(([key, entry]) => [key, canonicalJson(entry)]),
  );
};
