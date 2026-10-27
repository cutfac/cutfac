import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  BRIEF_FILE,
  briefLines,
  formatBrief,
  parseBrief,
  readBrief,
  updateBrief,
} from "../src/core/brief.ts";
import { InvalidRequest } from "../src/core/errors.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

describe("parsing brief.md", () => {
  test("reads the purpose, platforms, and the body", () => {
    const brief = parseBrief(
      "---\npurpose: promote\nplatforms: [tiktok, shorts]\n---\n\nShort videos for my app.\n",
    );

    expect(brief).toEqual({
      purpose: "promote",
      platforms: ["tiktok", "shorts"],
      body: "Short videos for my app.",
    });
  });

  test("leaves out what it doesn't know instead of failing", () => {
    const brief = parseBrief("---\npurpose: fame\nplatforms: [tiktok, myspace, tiktok]\n---\nHi");

    expect(brief).toEqual({ purpose: undefined, platforms: ["tiktok"], body: "Hi" });
  });

  test("a file without front matter, or with broken front matter, is all body", () => {
    expect(parseBrief("Just words.")).toEqual({
      purpose: undefined,
      platforms: [],
      body: "Just words.",
    });
    expect(parseBrief("---\nplatforms: [tiktok\n---\nWords").body).toBe("Words");
  });

  test("only a line of its own ends the front matter", () => {
    const brief = parseBrief("---\npurpose: tips\nnote: see you ---\nplatforms: [tiktok]\n---\nHi");

    expect(brief).toEqual({ purpose: "tips", platforms: ["tiktok"], body: "Hi" });
    expect(parseBrief("---\n---\nHi")).toEqual({ purpose: undefined, platforms: [], body: "Hi" });
  });

  test("writing keeps front matter keys the app doesn't know", () => {
    const previous = "---\npurpose: tips\nplatforms: [reels]\nvoice: calm\n---\nOld words\n";
    const text = formatBrief({ purpose: "brand", platforms: ["shorts"], body: "New" }, previous);

    expect(parseBrief(text)).toEqual({ purpose: "brand", platforms: ["shorts"], body: "New" });
    expect(text).toContain("voice: calm");
    expect(text).not.toContain("Old words");
  });

  test("an agent reads the purpose and platforms as sentences", () => {
    expect(briefLines({ purpose: "promote", platforms: ["tiktok", "reels"], body: "" })).toEqual([
      "The videos promote the user's own product or service.",
      "They go on TikTok, Instagram Reels.",
    ]);
    expect(briefLines({ platforms: [], body: "" })).toEqual([]);
  });

  test("a platform the list doesn't name points the agent at the user's own words", () => {
    expect(briefLines({ platforms: ["shorts", "other"], body: "Also LinkedIn." })).toEqual([
      "They go on YouTube Shorts, elsewhere, as the user's own words say.",
    ]);
  });
});

describe("brief.md in a workspace", () => {
  let ws: TestWorkspace;

  beforeEach(async () => {
    ws = await makeWorkspace();
  });

  afterEach(() => ws.remove());

  test("there is none until someone writes one", async () => {
    expect(await ws.run(readBrief())).toBeUndefined();
  });

  test("an update creates it, and the next one changes only what it names", async () => {
    await ws.run(updateBrief({ purpose: "promote", platforms: ["tiktok"], body: "My app." }));
    const brief = await ws.run(updateBrief({ platforms: ["tiktok", "shorts"] }));

    expect(brief).toEqual({ purpose: "promote", platforms: ["tiktok", "shorts"], body: "My app." });
    expect(await ws.run(readBrief())).toEqual(brief);
  });

  test("an update over a hand-written file keeps what the app doesn't read", async () => {
    await writeFile(join(ws.root, BRIEF_FILE), "---\nmaterial: [~/Brand]\n---\nMine\n");
    await ws.run(updateBrief({ purpose: "own" }));
    const text = await readFile(join(ws.root, BRIEF_FILE), "utf8");

    expect(text).toContain("material:");
    expect(parseBrief(text)).toEqual({ purpose: "own", platforms: [], body: "Mine" });
  });

  test("an update won't write over front matter it can't read", async () => {
    const broken = "---\nplatforms: [tiktok\nvoice: calm\n---\nMine\n";

    await writeFile(join(ws.root, BRIEF_FILE), broken);

    expect(await ws.fail(updateBrief({ purpose: "own" }))).toBeInstanceOf(InvalidRequest);
    expect(await readFile(join(ws.root, BRIEF_FILE), "utf8")).toBe(broken);
  });
});
