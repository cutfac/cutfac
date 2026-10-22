import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { McpLaunch } from "../src/core/agents.ts";
import { ALLOW_RULES, freshPrompt, turnMessage } from "../src/core/importPrompts.ts";
import { claudeImportFlags } from "../src/core/importRun.ts";
import { createImport } from "../src/core/imports.ts";
import type { ImportDoc, ImportTurn } from "../src/core/schema.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const SERVER: McpLaunch = { command: "cutfac", args: ["mcp", "--workspace", "/w"] };

const AT = "2026-10-13T00:00:00.000Z";

const FOLDER = "/w/.cutfac/imports/x";

let t: TestWorkspace;

beforeEach(async () => {
  t = await makeWorkspace("Brief imports");
});

afterEach(async () => {
  await t.remove();
});

const write = async (rel: string, text: string) => {
  await mkdir(dirname(join(t.root, rel)), { recursive: true });
  await writeFile(join(t.root, rel), text);
};

test("a brief import with no reference may write from the start", async () => {
  await write(".agents/skills/old/SKILL.md", "# old");
  await write("formats/existing/format.yaml", "name: Existing\n");

  for (const link of [undefined, "  "]) {
    const { doc } = await t.run(createImport({ kind: "brief", link, agent: "claude" }));

    expect(doc.link).toBeUndefined();
    expect(doc.allowed).toBe(true);
    expect(doc.baseline).toEqual({ skills: ["old"], formats: ["existing"] });
  }
});

test("a brief import with a reference reads first, as any import does", async () => {
  const { doc } = await t.run(
    createImport({ kind: "brief", link: " https://example.com/kit ", agent: "codex" }),
  );

  expect(doc).toMatchObject({ kind: "brief", link: "https://example.com/kit", allowed: false });
  expect(doc.baseline).toBeUndefined();
});

test("only a brief import may go without a link", async () => {
  const error = await t.fail(createImport({ agent: "claude" }));

  expect(error.message).toContain("http(s)");
});

test("with no reference, Claude's shell commands reach only code hosts", () => {
  const args = claudeImportFlags("install", SERVER, undefined);
  const settings = JSON.parse(args[args.indexOf("--settings") + 1] ?? "{}");

  expect(settings.sandbox.network.allowedDomains).toContain("github.com");
  expect(settings.sandbox.network.allowedDomains).not.toContain(undefined);
});

// --- What the agent is told -------------------------------------------------------------------

const briefDoc = (overrides: Partial<ImportDoc>): ImportDoc => ({
  kind: "brief",
  agent: "claude",
  allowed: true,
  turns: [],
  skills: [],
  formats: [],
  closed: false,
  created: AT,
  updated: AT,
  ...overrides,
});

const said = (id: string, kind: ImportTurn["kind"], body: string): ImportTurn => ({
  id,
  at: AT,
  kind,
  body,
});

test("the first message points at the brief, lets the agent write, and shows how to ask", () => {
  const start = said("t1", "start", "");
  const message = turnMessage(briefDoc({ locale: "ko", turns: [start] }), start, FOLDER);

  expect(message).toContain('"Make a template from the brief"');
  expect(message).toContain("no reference");
  expect(message).toContain("You may write in the workspace now");
  expect(message).toContain("```question");
  expect(message).toContain("```settled");
  expect(message).toContain("one question at a time");
  expect(message).toContain("Write to the user in Korean.");
  expect(message).not.toContain("press Allow");
});

test("with a reference, the first message names it and waits for Allow", () => {
  const start = said("t1", "start", "https://example.com/kit");
  const doc = briefDoc({ link: "https://example.com/kit", allowed: false, turns: [start] });
  const message = turnMessage(doc, start, FOLDER);

  expect(message).toContain("https://example.com/kit as the reference");
  expect(message).toContain("press Allow");
  expect(message).toContain("```question");
  expect(message).not.toContain("You may write in the workspace now");
});

test("with no reference, a reply goes as the user wrote it, and a new session hears no Allow", () => {
  const start: ImportTurn = {
    ...said("t1", "start", ""),
    run: { agent: "claude", status: "done", startedAt: AT, reply: "Which product?" },
  };

  const reply = said("t2", "reply", "The app");
  const doc = briefDoc({ turns: [start, reply] });

  expect(turnMessage(doc, reply, FOLDER)).toBe("The app");

  const fresh = freshPrompt(doc, reply, FOLDER);

  expect(fresh).toContain("You: Which product?");
  expect(fresh).not.toContain(ALLOW_RULES);
  expect(fresh.endsWith("The app")).toBe(true);
});
