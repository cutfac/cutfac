import { describe, expect } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer } from "effect";

import { CommandFailed } from "../src/core/errors.ts";
import { addLinkedVideo } from "../src/core/linkedVideos.ts";
import type { ReferenceFolder } from "../src/core/references.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace(), fakeAgents));

const folder: ReferenceFolder = {
  owner: "items/rice",
  name: "references",
  lock: "references:rice",
};

const listed = (...path: string[]) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const ws = yield* Workspace;

    return yield* fs.readDirectory(join(ws.root, "items", "rice", ...path));
  });

describe("a linked video", () => {
  it.live("is kept as a reference named after its title, with nothing left of the download", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const ws = yield* Workspace;

      yield* fakes.bin("yt-dlp", `printf 'clip' > source.mp4\necho "How to Cook Rice!"\n`);

      const first = yield* addLinkedVideo(folder, "https://youtu.be/abc");
      const second = yield* addLinkedVideo(folder, "https://youtu.be/abc");

      expect([first, second]).toEqual([
        "references/how-to-cook-rice.mp4",
        "references/how-to-cook-rice-2.mp4",
      ]);
      expect(yield* ws.readText("items/rice/references/how-to-cook-rice.mp4")).toBe("clip");
      expect(yield* listed(".downloads")).toEqual([]);
    }),
  );

  it.live("that yt-dlp could not download leaves nothing behind", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("yt-dlp", `echo "ERROR: Video unavailable" >&2\nexit 1\n`);

      const error = yield* Effect.flip(addLinkedVideo(folder, "https://youtu.be/gone"));

      expect(error).toBeInstanceOf(CommandFailed);
      expect(yield* listed()).toEqual([".downloads"]);
      expect(yield* listed(".downloads")).toEqual([]);
    }),
  );
});
