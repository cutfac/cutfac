import { describe, expect } from "bun:test";

import { Effect, Schema } from "effect";

import { fromTomlString, fromYamlString } from "../src/core/configText.ts";
import { it } from "./effect.ts";

const Config = Schema.Struct({ model: Schema.optional(Schema.String) });

const toml = Schema.decodeUnknownEffect(fromTomlString(Config));

const yaml = Schema.decodeUnknownEffect(fromYamlString(Schema.NullOr(Config)));

describe("config text", () => {
  it.effect("TOML is parsed and then decoded", () =>
    Effect.gen(function* () {
      expect(yield* toml('model = "gpt-5"\n[tui]\ntheme = "dark"\n')).toEqual({ model: "gpt-5" });
      expect(yield* toml("")).toEqual({});
    }),
  );

  it.effect("TOML that doesn't parse fails as the schema's own failures do", () =>
    Effect.gen(function* () {
      const unparsed = yield* Effect.flip(toml("model = "));
      const mistyped = yield* Effect.flip(toml("model = 3"));

      expect(unparsed.message).toContain("TOML document");
      expect(mistyped.message).toContain("model");
    }),
  );

  it.effect("YAML is parsed and then decoded, an empty document as null", () =>
    Effect.gen(function* () {
      expect(yield* yaml("model: gpt-5\n")).toEqual({ model: "gpt-5" });
      expect(yield* yaml("")).toBeNull();
      expect((yield* Effect.flip(yaml("model: [unclosed"))).message).toContain("YAML document");
      expect((yield* Effect.flip(yaml("- a\n- b\n"))).message).not.toContain("YAML document");
    }),
  );

  it.effect("they only read; writing config text back is refused", () =>
    Effect.gen(function* () {
      const write = Schema.encodeUnknownEffect(fromTomlString(Config));

      expect((yield* Effect.flip(write({ model: "gpt-5" }))).message).toContain("doesn't write");
    }),
  );
});
