import { describe, expect } from "bun:test";

import { Effect, Schema, Stream } from "effect";
import { Toolkit } from "effect/ai";

import { tool } from "../src/mcp/tool.ts";
import { testEffect } from "./effect.ts";

const Clip = Schema.Struct({ id: Schema.String, format: Schema.optional(Schema.String) });

const ListClips = tool("list_clips", {
  description: "Lists clips.",
  success: Schema.Struct({ clips: Schema.Array(Clip), note: Schema.optional(Schema.String) }),
  readonly: true,
});

const Clips = Toolkit.make(ListClips);

const it = testEffect(
  Clips.toLayer({
    list_clips: () =>
      Effect.succeed({
        clips: [
          { id: "a", format: "demo" },
          { id: "b", format: undefined },
        ],
        note: undefined,
      }),
  }),
);

describe("a tool's result", () => {
  it.effect("leaves out the fields its handler left undefined, however deep", () =>
    Effect.gen(function* () {
      const tools = yield* Clips;

      const result = yield* tools
        .handle("list_clips", {})
        .pipe(Effect.flatMap(Stream.runLast), Effect.flatMap(Effect.fromOption));

      expect(result.encodedResult).toStrictEqual({
        clips: [{ id: "a", format: "demo" }, { id: "b" }],
      });
    }),
  );
});
