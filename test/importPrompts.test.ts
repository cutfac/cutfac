import { expect, test } from "bun:test";

import { Option } from "effect";

import { ALLOW_RULES, freshPrompt, languageName, turnMessage } from "../src/core/importPrompts.ts";
import { allowedFromStart } from "../src/core/imports.ts";
import type { ImportDoc, ImportTurn } from "../src/core/importSchema.ts";

const AT = "2026-10-13T00:00:00.000Z";

const docWith = (overrides: Partial<ImportDoc>): ImportDoc => ({
  kind: "link",
  link: "https://example.com/pack",
  agent: "claude",
  allowed: false,
  turns: [],
  skills: [],
  formats: [],
  closed: false,
  created: AT,
  updated: AT,
  ...overrides,
});

const FOLDER = "/w/.cutfac/imports/x";

const said = (id: string, kind: ImportTurn["kind"], body: string): ImportTurn => ({
  id,
  at: AT,
  kind,
  body,
});

const answered = (
  id: string,
  kind: ImportTurn["kind"],
  body: string,
  reply: string,
): ImportTurn => ({
  ...said(id, kind, body),
  run: { agent: "claude", status: "done", startedAt: AT, reply },
});

test("a learn import reads about.md's unread sources into it, from the start, with nothing else", () => {
  const start = said("t1", "start", "");
  const doc = docWith({ kind: "learn", link: undefined, locale: "ko", turns: [start] });
  const message = turnMessage(doc, start, FOLDER);

  expect(allowedFromStart(doc)).toBe(true);
  expect(message).toContain("about.md");
  expect(message).toContain("Write only about.md");
  expect(message).toContain("Write to the user in Korean.");
  expect(message).not.toContain("press Allow");
});

test("the first message names the link and the user's language, and asks for Allow", () => {
  const start = said("t1", "start", "https://example.com/pack");
  const message = turnMessage(docWith({ locale: "ko", turns: [start] }), start, FOLDER);

  expect(message).toContain("https://example.com/pack");
  expect(message).toContain("Write to the user in Korean.");
  expect(message).toContain("press Allow");
  expect(turnMessage(docWith({ turns: [start] }), start, FOLDER)).not.toContain(
    "Write to the user in",
  );
});

test("a reply says writing is still blocked until the user allows", () => {
  const reply = said("t3", "reply", "Use the short version");
  const allowed = answered("t2", "allow", "", "Installed.");

  expect(turnMessage(docWith({}), reply, FOLDER)).toContain("still blocked");

  expect(turnMessage(docWith({ allowed: true, turns: [allowed, reply] }), reply, FOLDER)).toBe(
    "Use the short version",
  );
});

test("a reply carries the rules until a run that answered Allow finished", () => {
  const reply = said("t3", "reply", "Try again");

  const failed: ImportTurn = {
    ...said("t2", "allow", ""),
    run: { agent: "claude", status: "failed", startedAt: AT, error: "crashed" },
  };

  expect(turnMessage(docWith({ allowed: true, turns: [failed, reply] }), reply, FOLDER)).toBe(
    `${ALLOW_RULES}\n\nThe user added: Try again`,
  );
});

test("Allow carries the rules and what the user added", () => {
  expect(turnMessage(docWith({ allowed: true }), said("t2", "allow", ""), FOLDER)).toBe(
    ALLOW_RULES,
  );

  expect(
    turnMessage(docWith({ allowed: true }), said("t2", "allow", "Skip the fonts"), FOLDER),
  ).toBe(`${ALLOW_RULES}\n\nThe user added: Skip the fonts`);
});

test("the files a message carries go with it by their full path, and never change it otherwise", () => {
  const start = {
    ...said("t1", "start", "https://example.com/pack"),
    attachments: ["files/a.png"],
  };

  const opening = turnMessage(docWith({ turns: [start] }), start, FOLDER);

  expect(opening).toContain(`- ${FOLDER}/files/a.png`);
  expect(opening.indexOf("files/a.png")).toBeLessThan(opening.indexOf("press Allow"));

  const reply = { ...said("t3", "reply", "Use this logo"), attachments: ["files/logo.png"] };
  const allowed = answered("t2", "allow", "", "Installed.");
  const blocked = turnMessage(docWith({}), reply, FOLDER);

  expect(blocked.startsWith("Use this logo\n\nFiles the user attached.")).toBe(true);
  expect(blocked.indexOf("files/logo.png")).toBeLessThan(blocked.indexOf("still blocked"));

  expect(turnMessage(docWith({ allowed: true, turns: [allowed, reply] }), reply, FOLDER)).toBe(
    [
      "Use this logo",
      "",
      "Files the user attached. Open them and never change them; if the template needs any, copy them into the folder save_format returns:",
      `- ${FOLDER}/files/logo.png`,
    ].join("\n"),
  );
});

test("without a session, the prompt carries the conversation so far", () => {
  const next = said("t3", "reply", "Make it shorter");

  const turns = [
    answered("t1", "start", "https://example.com/pack", "It needs one skill."),
    answered("t2", "allow", "", "Installed."),
    next,
  ];

  const prompt = freshPrompt(docWith({ allowed: true, turns }), next, FOLDER);

  expect(prompt).toContain("Your earlier session is gone.");
  expect(prompt).toContain("You: It needs one skill.");
  expect(prompt).toContain("User: (pressed Allow)");
  expect(prompt).toContain("You: Installed.");
  expect(prompt.split(ALLOW_RULES)).toHaveLength(2);
  expect(prompt.endsWith("The user added: Make it shorter")).toBe(true);
});

test("without a session, the prompt names the files sent earlier, the first message's too", () => {
  const next = said("t3", "reply", "Make it shorter");

  const turns = [
    {
      ...answered("t1", "start", "https://example.com/pack", "Got it."),
      attachments: ["files/brief.md"],
    },
    { ...answered("t2", "reply", "Here is the logo", "Thanks."), attachments: ["files/logo.png"] },
    next,
  ];

  const prompt = freshPrompt(docWith({ turns }), next, FOLDER);

  expect(prompt).toContain(`- ${FOLDER}/files/brief.md`);
  expect(prompt).toContain(
    `User: Here is the logo\nUser attached:\n- ${FOLDER}/files/logo.png\nYou: Thanks.`,
  );
});

test("a locale that is not one names no language", () => {
  expect(languageName("ko-KR")).toEqual(Option.some("Korean"));
  expect(languageName("not a locale!")).toEqual(Option.none());
});
