import { describe, expect } from "bun:test";
import path from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Array, Effect, FileSystem, Option, Ref } from "effect";

import { publishBuild, ReleaseBucket } from "../electron/releaseBucket.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

const BUILDS = [
  "cutfac-0.2.0-arm64.dmg",
  "cutfac-0.2.0-arm64.dmg.blockmap",
  "cutfac-0.2.0-arm64.zip",
  "cutfac-0.2.0-arm64.zip.blockmap",
];

const buildFolder = (announced: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const folder = yield* fs.makeTempDirectoryScoped();

    yield* Effect.forEach(BUILDS, (name) => fs.writeFileString(path.join(folder, name), name), {
      discard: true,
    });
    yield* fs.writeFileString(path.join(folder, "latest-mac.yml"), `version: ${announced}\n`);

    return folder;
  });

/** A bucket whose uploads take a moment, which notes what was up when the feed's began. */
const fakeBucket = Effect.gen(function* () {
  const stored = yield* Ref.make<ReadonlyArray<string>>([]);
  const upAtFeed = yield* Ref.make(Option.none<ReadonlyArray<string>>());

  const bucket = ReleaseBucket.of({
    publishedVersion: Effect.succeedNone,
    upload: ({ name }) =>
      Effect.gen(function* () {
        if (name === "latest-mac.yml")
          yield* Ref.set(upAtFeed, Option.some(yield* Ref.get(stored)));

        yield* Effect.yieldNow;
        yield* Ref.update(stored, Array.append(name));
      }),
  });

  return { bucket, stored, upAtFeed };
});

describe("publishing a build", () => {
  it.live("puts the feed up only once every file it points apps at is up", () =>
    Effect.gen(function* () {
      const folder = yield* buildFolder("0.2.0");
      const { bucket, upAtFeed } = yield* fakeBucket;

      yield* publishBuild(folder, "0.2.0").pipe(Effect.provideService(ReleaseBucket, bucket));

      expect(Option.map(yield* Ref.get(upAtFeed), (up) => up.toSorted())).toEqual(
        Option.some(BUILDS),
      );
    }),
  );

  it.live("puts nothing up when the build's feed announces another version", () =>
    Effect.gen(function* () {
      const folder = yield* buildFolder("0.1.0");
      const { bucket, stored } = yield* fakeBucket;

      const error = yield* Effect.flip(
        publishBuild(folder, "0.2.0").pipe(Effect.provideService(ReleaseBucket, bucket)),
      );

      expect(error.message).toBe("The build did not produce a latest-mac.yml for 0.2.0.");
      expect(yield* Ref.get(stored)).toEqual([]);
    }),
  );
});
