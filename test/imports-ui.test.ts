import { describe, expect, test } from "bun:test";

import type { AgentRun, AgentStatus, ImportSummary, ImportTurn } from "../web/src/api.ts";
import {
  importAgent,
  importIdOf,
  importRouteId,
  importState,
  isWorking,
  linkLabel,
  turnRun,
} from "../web/src/lib/imports.ts";
import { NO_RUN, reduceRun, type LiveRun } from "../web/src/lib/run.ts";

const AT = "2026-10-12T00:00:00.000Z";

const run = (status: AgentRun["status"]): AgentRun => ({ agent: "claude", status, startedAt: AT });

function turn(id: string, kind: ImportTurn["kind"], status?: AgentRun["status"]): ImportTurn {
  const entry: ImportTurn = { id, at: AT, kind, body: "" };

  if (status !== undefined) entry.run = run(status);

  return entry;
}

const detail = (
  turns: ImportTurn[],
  { allowed = false, closed = false, running = false } = {},
): ImportSummary => ({
  id: "0a1b2c3d",
  doc: {
    kind: "link",
    link: "https://example.com/template",
    agent: "claude",
    allowed,
    turns,
    skills: [],
    formats: [],
    closed,
    created: AT,
    updated: AT,
  },
  running,
});

const streaming = (subject: string): LiveRun =>
  reduceRun(NO_RUN, { type: "start", subject, agent: "claude" });

describe("import state", () => {
  test("reads, waits for the user, installs, then is done", () => {
    expect(importState(detail([turn("t1", "start", "running")], { running: true }), NO_RUN)).toBe(
      "reading",
    );
    expect(importState(detail([turn("t1", "start", "done")]), NO_RUN)).toBe("waiting");

    const allowing = detail([turn("t1", "start", "done"), turn("t2", "allow", "running")], {
      allowed: true,
      running: true,
    });

    expect(importState(allowing, NO_RUN)).toBe("installing");

    const allowed = detail([turn("t1", "start", "done"), turn("t2", "allow", "done")], {
      allowed: true,
    });

    expect(importState(allowed, NO_RUN)).toBe("done");
    expect(importState({ ...allowed, doc: { ...allowed.doc, closed: true } }, NO_RUN)).toBe(
      "closed",
    );
  });

  test("a failed or stopped run, or none at all, leaves the import to retry", () => {
    expect(importState(detail([turn("t1", "start", "failed")]), NO_RUN)).toBe("failed");
    expect(importState(detail([turn("t1", "start", "stopped")]), NO_RUN)).toBe("stopped");
    expect(importState(detail([]), NO_RUN)).toBe("failed");
  });

  test("a run saved as running with no agent behind it was cut off", () => {
    expect(importState(detail([turn("t1", "start", "running")]), NO_RUN)).toBe("stopped");
  });

  test("the stream wins over the saved run for the turn it is about", () => {
    const saved = detail([turn("t1", "start", "done"), turn("t2", "reply", "running")], {
      running: true,
    });

    const done = reduceRun(streaming("t2"), { type: "done", reply: "Ready." });

    // The run ended, but the import was loaded before the server let go of it.
    expect(importState(saved, done)).toBe("waiting");
    expect(turnRun(saved, saved.doc.turns[1]!, done)).toMatchObject({
      status: "done",
      running: false,
      reply: "Ready.",
    });

    // A stream still on the turn before does not speak for the new one.
    expect(importState(saved, streaming("t1"))).toBe("reading");
  });

  test("only the last turn can have an agent on it", () => {
    const restarted = detail([turn("t1", "start", "running"), turn("t2", "reply", "running")], {
      running: true,
    });

    expect(turnRun(restarted, restarted.doc.turns[0]!, NO_RUN)).toMatchObject({
      status: "stopped",
      running: false,
    });
    expect(turnRun(restarted, restarted.doc.turns[1]!, NO_RUN).running).toBe(true);
  });

  test("working states take no message", () => {
    expect(isWorking("reading")).toBe(true);
    expect(isWorking("installing")).toBe(true);
    expect(isWorking("waiting")).toBe(false);
    expect(isWorking("done")).toBe(false);
  });
});

describe("import routes and labels", () => {
  test("an import opens on the Templates page under its own prefix", () => {
    expect(importIdOf(importRouteId("0a1b2c3d"))).toBe("0a1b2c3d");
    expect(importIdOf("vertical-explainer")).toBeUndefined();
    expect(importIdOf(undefined)).toBeUndefined();
  });

  test("a link is named by its host and path", () => {
    expect(linkLabel("https://www.github.com/acme/reels/")).toBe("github.com/acme/reels");
    expect(linkLabel("https://example.com/")).toBe("example.com");
    expect(linkLabel("not a link")).toBe("not a link");
  });
});

const status = (agent: AgentStatus["agent"], installed: boolean): AgentStatus => ({
  agent,
  installed,
  connected: false,
  models: [],
  efforts: [],
});

describe("import agent", () => {
  test("the workspace default is used when it is installed", () => {
    expect(importAgent("codex", [status("claude", true), status("codex", true)])).toBe("codex");
  });

  test("otherwise the first installed agent is", () => {
    expect(importAgent("codex", [status("claude", true), status("codex", false)])).toBe("claude");
    expect(importAgent("queue", [status("claude", false), status("codex", true)])).toBe("codex");
    expect(importAgent(undefined, [status("claude", true), status("codex", true)])).toBe("claude");
  });

  test("none when no agent is installed", () => {
    expect(importAgent("claude", [status("claude", false), status("codex", false)])).toBe(
      undefined,
    );
  });

  test("before the list loads the default stands, and copying the prompt is not an agent", () => {
    expect(importAgent("codex", undefined)).toBe("codex");
    expect(importAgent("queue", undefined)).toBe("claude");
    expect(importAgent(undefined, undefined)).toBe("claude");
  });
});
