import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import type { Format, FormatStatus, InputField } from "../web/src/api.ts";
import {
  coverOf,
  filledInputs,
  fixPrompt,
  importPrompt,
  isClip,
  missingFiles,
  missingInputs,
  sortTemplates,
  templateState,
} from "../web/src/lib/templates.ts";

const format = (id: string, title: string): Format => ({
  id,
  dir: `formats/${id}`,
  doc: {
    title,
    summary: "",
    references: [],
    aspects: ["9x16"],
    requireAudio: false,
    hookRules: [],
    structure: [],
    checklist: [],
    skills: [],
    requires: [],
    inputs: [],
  },
});

function status(id: string, title: string | undefined, ready: boolean): FormatStatus {
  const result: FormatStatus = { id, check: { ready, problems: [], skills: {} } };

  return title === undefined ? result : { ...result, format: format(id, title) };
}

const field = (id: string, overrides: Partial<InputField> = {}): InputField => ({
  id,
  title: id,
  choices: [],
  required: false,
  ...overrides,
});

describe("templateState", () => {
  test("a format that does not read is broken, whatever its check says", () => {
    expect(templateState(status("a", undefined, true))).toBe("broken");
  });

  test("a readable format is ready or incomplete by its check", () => {
    expect(templateState(status("a", "A", true))).toBe("ready");
    expect(templateState(status("a", "A", false))).toBe("incomplete");
  });
});

describe("sortTemplates", () => {
  test("puts ready templates first, then incomplete, then broken, each by title", () => {
    const sorted = sortTemplates([
      status("zeta", undefined, false),
      status("b", "Beta", false),
      status("c", "Charlie", true),
      status("a", "Alpha", true),
      status("alpha", undefined, false),
    ]);

    expect(sorted.map((s) => s.id)).toEqual(["a", "c", "b", "alpha", "zeta"]);
  });

  test("leaves its input alone", () => {
    const statuses = [status("b", "B", false), status("a", "A", true)];

    sortTemplates(statuses);
    expect(statuses.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("filledInputs", () => {
  test("trims values and drops blanks and fields the template does not declare", () => {
    const fields = [field("style"), field("hook"), field("tone")];

    expect(filledInputs(fields, { style: "  ink ", hook: "   ", stray: "x" })).toEqual({
      style: "ink",
    });
  });
});

describe("missingInputs", () => {
  test("lists required inputs with neither a value nor a default", () => {
    const fields = [
      field("style", { required: true }),
      field("tone", { required: true, default: "calm" }),
      field("hook", { required: true }),
      field("note"),
    ];

    expect(missingInputs(fields, { hook: "a question" }).map((f) => f.id)).toEqual(["style"]);
    expect(missingInputs(fields, { style: " ", hook: "x" }).map((f) => f.id)).toEqual(["style"]);
    expect(missingInputs(fields, { style: "ink", hook: "x" })).toEqual([]);
  });
});

describe("agent prompts", () => {
  test("the import prompt names the link and the workspace, and ends at check_format", () => {
    const prompt = importPrompt("  https://example.com/post  ", "/work/space");

    expect(prompt).toContain("Read https://example.com/post and");
    expect(prompt).toContain("/work/space");
    expect(prompt).toContain("check_format");
    expect(prompt).toContain("ask me before installing");
  });

  test("the fix prompt names the template and the workspace", () => {
    const prompt = fixPrompt("art-motion", "/work/space");

    expect(prompt).toContain('"art-motion"');
    expect(prompt).toContain("/work/space");
    expect(prompt).toContain("check_format");
  });
});

describe("isClip", () => {
  test("tells clips from stills by extension", () => {
    expect(isClip("previews/ink.MP4")).toBe(true);
    expect(isClip("previews/ink.webm")).toBe(true);
    expect(isClip("previews/ink.png")).toBe(false);
    expect(isClip("previews/mp4.jpg")).toBe(false);
  });
});

function withPreviews(...previews: string[]): FormatStatus {
  const art = format("art", "Art");

  const style = field("style", {
    choices: previews.map((preview, i) => ({ id: `c${i}`, title: preview, preview, files: [] })),
  });

  return {
    id: "art",
    format: { ...art, doc: { ...art.doc, inputs: [style] } },
    check: { ready: false, problems: [], skills: {} },
  };
}

describe("coverOf", () => {
  test("is the first still preview, relative to the workspace", () => {
    expect(coverOf(withPreviews("previews/ink.mp4", "previews/ink.png"))).toEqual(
      Option.some("formats/art/previews/ink.png"),
    );
  });

  test("skips previews the check reports missing", () => {
    const previewed = withPreviews("previews/gone.png", "previews/here.png");

    const art: FormatStatus = {
      ...previewed,
      check: {
        ...previewed.check,
        problems: [{ kind: "file", subject: "previews/gone.png", message: "missing" }],
      },
    };

    expect(missingFiles(art)).toEqual(new Set(["previews/gone.png"]));
    expect(coverOf(art)).toEqual(Option.some("formats/art/previews/here.png"));
  });

  test("is none for a template that does not read or has no stills", () => {
    expect(coverOf(status("bad", undefined, false))).toEqual(Option.none());
    expect(coverOf(withPreviews("previews/ink.webm"))).toEqual(Option.none());
  });
});
