import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Effect, Schema } from "effect";

import { InvalidRequest } from "../src/core/errors.ts";
import {
  checkFormat,
  formatStatuses,
  isFormatPath,
  resolveInputs,
  specProblems,
} from "../src/core/formatSpec.ts";
import { createItem } from "../src/core/items.ts";
import { listFormats, saveFormat } from "../src/core/library.ts";
import { FormatDoc } from "../src/core/schema.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const decode = (doc: typeof FormatDoc.Encoded) => Schema.decodeSync(FormatDoc)(doc);

const STYLE = {
  id: "style",
  title: "Style",
  choices: [
    { id: "swiss", title: "Swiss grid", preview: "previews/swiss.png", files: ["styles/swiss.md"] },
    { id: "neon", title: "Neon" },
  ],
  default: "swiss",
};

describe("specProblems", () => {
  test("a plain format has none", () => {
    expect(specProblems(decode({ title: "Plain" }))).toEqual([]);
  });

  test("names ids, defaults, skills, programs, and paths that cannot work", () => {
    const doc = decode({
      title: "Broken",
      duration: { min: 30, max: 10 },
      skills: [{ name: "Huashu Art" }],
      requires: ["uv run deliver.py"],
      inputs: [
        { ...STYLE, default: "pastel" },
        { id: "style", title: "Again" },
        {
          id: "look",
          title: "Look",
          choices: [
            { id: "a", title: "A", preview: "../outside.png" },
            { id: "a", title: "A again" },
          ],
        },
      ],
    });

    expect(specProblems(doc).map((p) => p.message)).toEqual([
      "duration.min is longer than duration.max",
      'Skill name "Huashu Art" must be lowercase words joined by hyphens',
      '"uv run deliver.py" is not a program name; list just the name',
      'Input "style" appears twice',
      'Default "pastel" is not one of the choices',
      'Choice "a" appears twice',
      '"../outside.png" must be a path inside the format folder',
    ]);
  });

  test("format paths stay inside the folder", () => {
    expect(isFormatPath("previews/a.png")).toBe(true);
    expect(isFormatPath("/etc/passwd")).toBe(false);
    expect(isFormatPath("a/../../b")).toBe(false);
    expect(isFormatPath("C:/x")).toBe(false);
    expect(isFormatPath("a//b")).toBe(false);
  });
});

describe("resolveInputs", () => {
  const fields = decode({
    title: "T",
    inputs: [STYLE, { id: "topic", title: "Topic", required: true }, { id: "cta", title: "CTA" }],
  }).inputs;

  test("fills defaults and keeps the format's order", async () => {
    const inputs = await Effect.runPromise(
      resolveInputs("t", fields, { topic: " Forks ", cta: "" }),
    );

    expect(inputs).toEqual({ style: "swiss", topic: "Forks" });
    expect(Object.keys(inputs)).toEqual(["style", "topic"]);
  });

  const fail = (given: Record<string, string>) =>
    Effect.runPromise(Effect.flip(resolveInputs("t", fields, given)));

  test("refuses unknown inputs, missing required ones, and choices that are not there", async () => {
    expect((await fail({ topic: "x", mood: "calm" })).message).toBe(
      "Format t has no input mood (its inputs: style, topic, cta)",
    );
    expect((await fail({})).message).toBe("Format t needs Topic (topic)");
    expect((await fail({ topic: "x", style: "pastel" })).message).toBe(
      "Style (style) must be one of swiss, neon",
    );
  });
});

describe("formats in a workspace", () => {
  let t: TestWorkspace;

  const put = async (rel: string, text = "") => {
    await mkdir(dirname(join(t.root, rel)), { recursive: true });
    await writeFile(join(t.root, rel), text);
  };

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("reports missing skills, programs, and files, then passes once they are there", async () => {
    await t.run(
      saveFormat({
        ...decode({
          title: "Art motion",
          skills: [{ name: "art-motion", source: "https://github.com/example/art-motion" }],
          requires: ["sh", "surely-not-installed-cf"],
          inputs: [STYLE],
        }),
        id: "art",
      }),
    );

    const before = await t.run(checkFormat("art"));

    expect(before.ready).toBe(false);
    expect(before.problems.map((p) => [p.kind, p.subject])).toEqual([
      ["skill", "art-motion"],
      ["program", "surely-not-installed-cf"],
      ["file", "previews/swiss.png"],
      ["file", "styles/swiss.md"],
    ]);
    expect(before.problems[0]?.message).toContain("from https://github.com/example/art-motion");

    await put(".claude/skills/art-motion/SKILL.md", "---\nname: art-motion\n---\n");
    await put("formats/art/previews/swiss.png");
    await put("formats/art/styles/swiss.md");

    const after = await t.run(checkFormat("art"));

    expect(after.problems.map((p) => p.subject)).toEqual(["surely-not-installed-cf"]);
    expect(after.skills).toEqual({ "art-motion": ".claude/skills/art-motion/SKILL.md" });
  });

  test("a format.yaml that does not decode is reported, and the list skips it", async () => {
    await t.run(saveFormat({ ...decode({ title: "Good" }), id: "good" }));
    await put("formats/bad/format.yaml", "summary: no title\n");

    const statuses = await t.run(formatStatuses());

    expect(statuses.map((s) => [s.id, s.check.ready, s.format?.id])).toEqual([
      ["bad", false, undefined],
      ["good", true, "good"],
    ]);
    expect(statuses[0]?.check.problems[0]?.kind).toBe("spec");
    expect((await t.run(listFormats())).map((f) => f.id)).toEqual(["good"]);
  });

  test("a new item keeps its format's inputs", async () => {
    await t.run(saveFormat({ ...decode({ title: "Art", inputs: [STYLE] }), id: "art" }));

    const item = await t.run(createItem({ title: "Openings", format: "art", inputs: {} }));

    const picked = await t.run(
      createItem({ title: "Endgames", format: "art", inputs: { style: "neon" } }),
    );

    expect(item.doc.inputs).toEqual({ style: "swiss" });
    expect(picked.doc.inputs).toEqual({ style: "neon" });

    const wrong = await t.fail(
      createItem({ title: "Tactics", format: "art", inputs: { style: "x" } }),
    );

    const loose = await t.fail(createItem({ title: "Loose", inputs: { style: "neon" } }));

    expect(wrong).toBeInstanceOf(InvalidRequest);
    expect(loose.message).toBe("Inputs belong to a format; pick one first");
  });

  test("an item may name a format that has no folder, as before", async () => {
    const item = await t.run(createItem({ title: "Trap", format: "trap" }));

    expect(item.doc.inputs).toBeUndefined();
  });
});
