import { describe, expect } from "bun:test";

// A workspace made for one check is provided where that check runs.
// @effect-diagnostics strictEffectProvide:off
import { Effect, FileSystem, Layer, Option } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { createCountedItem, DesktopData, FREE_VIDEOS, planStatus, workOn } from "../src/plan.ts";
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
      expect(ko.find((sample) => sample.id === "calm")?.title).toBe("숨");
      expect(en.find((sample) => sample.id === "calm")?.title).toBe("Still");
    }),
  );

  it.live("one copied in has its video and the code to render it, in the language asked", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const item = yield* addSample("calm", "en", "Sample: Still");
      const copy = yield* ws.readText(`${item.dir}/src/copy.json`);

      expect(item.doc.title).toBe("Sample: Still");
      expect(item.media.map((media) => media.name)).toEqual(["[9x16] calm.mp4"]);
      expect(JSON.parse(copy)).toMatchObject({ title: "Still" });

      for (const file of ["reel.py", "motion.py", "fonts/GowunBatang-Regular.ttf"]) {
        expect(yield* ws.exists(`${item.dir}/src/${file}`)).toBe(true);
      }
    }),
  );

  it.live("working on one never uses a free video, even once they are all used", () =>
    Effect.gen(function* () {
      const sample = yield* addSample("bold", "ko", "샘플: FLOW");

      yield* workOn(sample.id);

      expect(yield* planStatus()).toMatchObject({ used: 0 });

      yield* Effect.forEach(["One", "Two", "Three"], (title) => createCountedItem({ title }));
      yield* workOn(sample.id);

      expect(yield* planStatus()).toMatchObject({ used: FREE_VIDEOS });
    }),
  );
});
