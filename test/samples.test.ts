import { describe, expect } from "bun:test";

// A workspace made for one check is provided where that check runs.
// @effect-diagnostics strictEffectProvide:off
import { Effect, FileSystem, Layer, Option } from "effect";

import { listItemIds } from "../src/core/items.ts";
import { Workspace } from "../src/core/workspace.ts";
import { createCountedItem, DesktopData, FreeLimitReached, planStatus } from "../src/plan.ts";
import { addSample, listSamples } from "../src/samples.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace, testLicenseKey } from "./support.ts";

const appDataFolder = Layer.effect(
  DesktopData,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return Option.some(yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-data-" }));
  }),
);

const it = testEffect(
  appDataFolder.pipe(Layer.provideMerge(Layer.mergeAll(tempWorkspace(), testLicenseKey))),
);

describe("samples", () => {
  it.live("each is titled in the language asked", () =>
    Effect.gen(function* () {
      const ko = yield* listSamples("ko");
      const en = yield* listSamples("en");

      expect(ko.map((sample) => sample.id)).toEqual(en.map((sample) => sample.id));
      expect(ko.find((sample) => sample.id === "playful")?.title).toBe("꾸준");
      expect(en.find((sample) => sample.id === "playful")?.title).toBe("Steady");
    }),
  );

  it.live("one copied in has its video and the code to render it, in the language asked", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const item = yield* addSample("playful", "en", "Sample: Steady");
      const copy = yield* ws.readText(`${item.dir}/src/copy.json`);

      expect(item.doc.title).toBe("Sample: Steady");
      expect(item.media.map((media) => media.name)).toEqual(["[9x16] playful.mp4"]);
      expect(JSON.parse(copy)).toMatchObject({ title: "Steady" });

      for (const file of [
        "index.html",
        "motion.js",
        "render.mjs",
        "package.json",
        "fonts/Jua.ttf",
      ]) {
        expect(yield* ws.exists(`${item.dir}/src/${file}`)).toBe(true);
      }
    }),
  );

  it.live("one copied in is one of the free videos, and past them none is copied", () =>
    Effect.gen(function* () {
      yield* addSample("bold", "ko", "샘플: FLOW");

      expect(yield* planStatus()).toMatchObject({ used: 1 });

      yield* Effect.forEach(["One", "Two"], (title) => createCountedItem({ title }));

      expect(yield* Effect.flip(addSample("calm", "ko", "샘플: 숨"))).toBeInstanceOf(
        FreeLimitReached,
      );
      expect(yield* listItemIds()).toHaveLength(3);
    }),
  );
});
