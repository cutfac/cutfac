import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Effect, FileSystem, Schema } from "effect";

import { InvalidRequest } from "../src/core/errors.ts";
import { FormatDoc } from "../src/core/formatSchema.ts";
import {
  checkFormat,
  formatStatuses,
  isFormatPath,
  resolveInputs,
  specProblems,
} from "../src/core/formatSpec.ts";
import { createItem } from "../src/core/items.ts";
import { formatNotices, listFormats, readFormats, saveFormat } from "../src/core/library.ts";
import { Workspace } from "../src/core/workspace.ts";
import { it as pure, testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

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

  pure.effect("fills defaults and keeps the format's order", () =>
    Effect.gen(function* () {
      const inputs = yield* resolveInputs("t", fields, { topic: " Forks ", cta: "" });

      expect(inputs).toEqual({ style: "swiss", topic: "Forks" });
      expect(Object.keys(inputs)).toEqual(["style", "topic"]);
    }),
  );

  const refused = (given: Record<string, string>) => Effect.flip(resolveInputs("t", fields, given));

  pure.effect("refuses unknown inputs, missing required ones, and choices that are not there", () =>
    Effect.gen(function* () {
      expect((yield* refused({ topic: "x", mood: "calm" })).message).toBe(
        "Format t has no input mood (its inputs: style, topic, cta)",
      );
      expect((yield* refused({})).message).toBe("Format t needs Topic (topic)");
      expect((yield* refused({ topic: "x", style: "pastel" })).message).toBe(
        "Style (style) must be one of swiss, neon",
      );
    }),
  );
});

const put = (rel: string, text = "") => Effect.flatMap(Workspace, (ws) => ws.writeText(rel, text));

describe("formats in a workspace", () => {
  it.live("reports missing skills, programs, and files, then passes once they are there", () =>
    Effect.gen(function* () {
      yield* saveFormat({
        ...decode({
          title: "Art motion",
          skills: [{ name: "art-motion", source: "https://github.com/example/art-motion" }],
          requires: ["sh", "surely-not-installed-cutfac"],
          inputs: [STYLE],
        }),
        id: "art",
      });

      const before = yield* checkFormat("art");

      expect(before.ready).toBe(false);
      expect(before.problems.map((p) => [p.kind, p.subject])).toEqual([
        ["skill", "art-motion"],
        ["program", "surely-not-installed-cutfac"],
        ["file", "previews/swiss.png"],
        ["file", "styles/swiss.md"],
      ]);
      expect(before.problems[0]?.message).toContain("from https://github.com/example/art-motion");

      yield* put(".claude/skills/art-motion/SKILL.md", "---\nname: art-motion\n---\n");
      yield* put("formats/art/previews/swiss.png");
      yield* put("formats/art/styles/swiss.md");

      const after = yield* checkFormat("art");

      expect(after.problems.map((p) => p.subject)).toEqual(["surely-not-installed-cutfac"]);
      expect(after.skills).toEqual({ "art-motion": ".claude/skills/art-motion/SKILL.md" });
    }),
  );

  it.live("says where each program is and its version, so an agent need not look", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const ws = yield* Workspace;
      const bin = join(ws.root, "bin");

      yield* put("bin/tool", "#!/bin/sh\necho 'tool 2.4.1'\necho 'more'\n");
      yield* put("bin/mute", "#!/bin/sh\nexit 1\n");
      yield* fs.chmod(join(bin, "tool"), 0o755);
      yield* fs.chmod(join(bin, "mute"), 0o755);
      yield* saveFormat({ ...decode({ title: "Art", requires: ["tool", "mute"] }), id: "art" });

      const check = yield* checkFormat("art").pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromEnv({ env: { PATH: bin } }),
        ),
      );

      expect(check.ready).toBe(true);
      expect(check.programs).toEqual({
        tool: { path: join(bin, "tool"), version: "tool 2.4.1" },
        mute: { path: join(bin, "mute") },
      });
    }),
  );

  it.live("a link that carries a password or token is not saved", () =>
    Effect.gen(function* () {
      const source = yield* Effect.flip(
        saveFormat({
          ...decode({ title: "Art", source: { url: "https://user:pass@example.com/art" } }),
          id: "art",
        }),
      );

      expect(source.message).toContain("source.url carries a password or token");

      const skill = yield* Effect.flip(
        saveFormat({
          ...decode({
            title: "Art",
            skills: [{ name: "art-motion", source: "https://example.com/skill.zip?token=abc" }],
          }),
          id: "art",
        }),
      );

      expect(skill.message).toContain("skill art-motion carries a password or token");
      expect(yield* formatStatuses()).toEqual([]);
    }),
  );

  it.live("a format.yaml that does not decode is reported, and the list skips it", () =>
    Effect.gen(function* () {
      yield* saveFormat({ ...decode({ title: "Good" }), id: "good" });
      yield* put("formats/bad/format.yaml", "summary: no title\n");

      const statuses = yield* formatStatuses();

      expect(statuses.map((s) => [s.id, s.check.ready, s.format?.id])).toEqual([
        ["bad", false, undefined],
        ["good", true, "good"],
      ]);
      expect(statuses[0]?.check.problems[0]?.kind).toBe("spec");
      expect((yield* listFormats()).map((f) => f.id)).toEqual(["good"]);
    }),
  );

  it.live("a format.yaml without a title becomes a notice, and the other formats still list", () =>
    Effect.gen(function* () {
      yield* saveFormat({ ...decode({ title: "Good" }), id: "good" });
      yield* put("formats/bad/format.yaml", "summary: no title\n");

      const { formats, unreadable } = yield* readFormats();
      const notices = formatNotices(unreadable);

      expect(formats.map((f) => f.id)).toEqual(["good"]);
      expect(notices).toHaveLength(1);
      expect(notices[0]).toContain('Format "bad"');
      expect(notices[0]).toContain('formats/bad/format.yaml: Missing key at ["title"]');
      expect(notices[0]).toContain('check_format with id "bad"');
    }),
  );

  it.live("lists formats in name order, however long each check takes", () =>
    Effect.gen(function* () {
      const ids = Array.from({ length: 24 }, (_, n) => `f${String(n).padStart(2, "0")}`);

      yield* Effect.forEach(ids, (id) => put(`formats/${id}/format.yaml`, `title: ${id}\n`), {
        concurrency: "unbounded",
      });
      yield* put("formats/empty/notes.md");

      expect((yield* formatStatuses()).map((s) => s.id)).toEqual(ids);
      expect((yield* listFormats()).map((f) => f.id)).toEqual(ids);
    }),
  );

  it.live("a new item keeps its format's inputs", () =>
    Effect.gen(function* () {
      yield* saveFormat({ ...decode({ title: "Art", inputs: [STYLE] }), id: "art" });

      const item = yield* createItem({ title: "Morning routine", format: "art", inputs: {} });

      const picked = yield* createItem({
        title: "Evening routine",
        format: "art",
        inputs: { style: "neon" },
      });

      expect(item.doc.inputs).toEqual({ style: "swiss" });
      expect(picked.doc.inputs).toEqual({ style: "neon" });

      const wrong = yield* Effect.flip(
        createItem({ title: "Tactics", format: "art", inputs: { style: "x" } }),
      );

      const loose = yield* Effect.flip(createItem({ title: "Loose", inputs: { style: "neon" } }));

      expect(wrong).toBeInstanceOf(InvalidRequest);
      expect(loose.message).toBe("Inputs belong to a format; pick one first");
    }),
  );

  it.live("an item may name a format that has no folder, as before", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Tips", format: "tips" });

      expect(item.doc.inputs).toBeUndefined();
    }),
  );
});
