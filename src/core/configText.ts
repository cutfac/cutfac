import { Effect, Schema, SchemaGetter, SchemaIssue, SchemaTransformation } from "effect";
import { parse as parseYaml } from "yaml";

/**
 * Text that `parse` reads, decoded with `schema` as `Schema.fromJsonString` does JSON: text the
 * parser can't read fails like any other value the schema rejects. These read config files the
 * user writes, which the app never writes back, so they only decode.
 */
const fromText =
  <A>(expected: string, parse: (text: string) => A) =>
  <S extends Schema.Constraint>(schema: S) =>
    Schema.String.pipe(
      Schema.decodeTo(
        schema,
        new SchemaTransformation.Transformation<unknown, string>(
          SchemaGetter.transformEffect((text: string, options) =>
            Effect.try({
              try: () => parse(text),
              catch: () => new SchemaIssue.InvalidValue({ expected }, text, options),
            }),
          ),
          SchemaGetter.forbidden(() => `Cutfac reads ${expected}s but doesn't write them`),
        ),
      ),
    );

/** A TOML document, such as Codex's `config.toml`, decoded with `schema`. */
export const fromTomlString = fromText("TOML document", (text) => Bun.TOML.parse(text));

/** A YAML document, such as a file's front matter, decoded with `schema`. */
export const fromYamlString = fromText("YAML document", (text) => parseYaml(text));
