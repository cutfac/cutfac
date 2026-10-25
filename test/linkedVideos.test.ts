import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { CommandFailed } from "../src/core/errors.ts";
import { addLinkedVideo } from "../src/core/linkedVideos.ts";
import type { ReferenceFolder } from "../src/core/references.ts";
import { type FakeAgents, makeFakeAgents, makeWorkspace, type TestWorkspace } from "./support.ts";

const folder: ReferenceFolder = {
  owner: "items/rice",
  name: "references",
  lock: "references:rice",
};

describe("a linked video", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace();
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await t.remove();
    await fakes.remove();
  });

  const item = (...path: string[]) => join(t.root, "items", "rice", ...path);

  test("is kept as a reference named after its title, with nothing left of the download", async () => {
    await fakes.bin("yt-dlp", `printf 'clip' > source.mp4\necho "How to Cook Rice!"\n`);

    const first = await t.runWith(fakes.layer, addLinkedVideo(folder, "https://youtu.be/abc"));
    const second = await t.runWith(fakes.layer, addLinkedVideo(folder, "https://youtu.be/abc"));

    expect([first, second]).toEqual([
      "references/how-to-cook-rice.mp4",
      "references/how-to-cook-rice-2.mp4",
    ]);
    expect(await readFile(item("references", "how-to-cook-rice.mp4"), "utf8")).toBe("clip");
    expect(await readdir(item(".downloads"))).toEqual([]);
  });

  test("that yt-dlp could not download leaves nothing behind", async () => {
    await fakes.bin("yt-dlp", `echo "ERROR: Video unavailable" >&2\nexit 1\n`);

    const error = await t.runWith(
      fakes.layer,
      Effect.flip(addLinkedVideo(folder, "https://youtu.be/gone")),
    );

    expect(error).toBeInstanceOf(CommandFailed);
    expect(await readdir(item())).toEqual([".downloads"]);
    expect(await readdir(item(".downloads"))).toEqual([]);
  });
});
