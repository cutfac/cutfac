import { describe, expect, test } from "bun:test";

import type { AgentRun, Feedback, ItemSummary } from "../web/src/api.ts";
import type { RenderState } from "../web/src/lib/render.ts";
import {
  attention,
  byWork,
  inProgress,
  isBusy,
  itemWork,
  needsYou,
  waitingCount,
} from "../web/src/lib/work.ts";

const at = (second: number) => new Date(Date.UTC(2026, 9, 25, 0, 0, second)).toISOString();

const request = (id: string, extra: Partial<Feedback> = {}): Feedback => ({
  id,
  at: at(1),
  author: "user",
  body: `request ${id}`,
  media: "clip.mp4",
  status: "open",
  ...extra,
});

const run = (status: AgentRun["status"]): AgentRun => ({
  agent: "claude",
  status,
  startedAt: at(1),
});

const render: RenderState = {
  item: "item",
  command: "bun run render",
  cwd: ".",
  label: "v2",
  status: "running",
  progress: { stage: "frames", percent: 0.5 },
  startedAt: 0,
  log: [],
};

function summary(extra: Partial<ItemSummary> = {}): ItemSummary {
  return {
    id: "item",
    dir: "items/item",
    title: "Item",
    status: "drafting",
    openFeedback: 0,
    requests: [],
    running: false,
    approvals: 0,
    questions: 0,
    media: [{ name: "clip.mp4", kind: "video", size: 1, mtime: Date.parse(at(0)) }],
    updatedAt: 0,
    ...extra,
  };
}

const versions = request("versions", {
  variants: {
    saved: [
      { id: "a", label: "A", file: "a.mp4", at: at(2) },
      { id: "b", label: "B", file: "b.mp4", at: at(2) },
    ],
  },
});

describe("itemWork", () => {
  test("versions to pick come before everything else", () => {
    const work = itemWork(summary({ requests: [versions], running: true, render }));

    expect(work).toEqual({ kind: "versions", request: versions, labels: ["A", "B"] });
    expect(needsYou(work)).toBe(true);
  });

  test("versions the agent is still making wait for its run to end", () => {
    const making = { ...versions, run: run("running") };

    expect(itemWork(summary({ requests: [making], running: true }))).toEqual({
      kind: "working",
      request: making,
    });
    expect(itemWork(summary({ requests: [{ ...making, run: run("done") }] }))).toMatchObject({
      kind: "versions",
      labels: ["A", "B"],
    });
  });

  test("a failed or stopped run with its request open waits for the user", () => {
    const failed = request("failed", { run: run("failed") });

    expect(itemWork(summary({ requests: [failed] }))).toEqual({ kind: "halted", request: failed });
  });

  test("a resolved request still shows its versions and result until the user decides", () => {
    const resolved = { status: "resolved", run: run("stopped") } as const;
    const kept = { ...versions, ...resolved };
    const changed = request("changed", { ...resolved, context: { before: "b", after: "a" } });

    expect(itemWork(summary({ requests: [kept] }))).toMatchObject({ kind: "versions" });
    expect(itemWork(summary({ requests: [changed] }))).toEqual({
      kind: "result",
      request: changed,
    });
    expect(itemWork(summary({ requests: [{ ...changed, decision: "approved" }] }))).toEqual({
      kind: "quiet",
    });
  });

  test("a render reports its version and how much is done", () => {
    const work = itemWork(summary({ render }));

    expect(work.kind).toBe("rendering");
    expect(work).toMatchObject({ label: "v2" });
    expect(isBusy(work)).toBe(true);
  });

  test("a failed render waits for the user until they look at it", () => {
    const failed: RenderState = { ...render, status: "failed", endedAt: 1, code: 1 };
    const work = itemWork(summary({ render: failed }));

    expect(work).toEqual({ kind: "renderFailed", label: "v2" });
    expect(needsYou(work)).toBe(true);
    expect(isBusy(work)).toBe(false);
    expect(itemWork(summary({ render: failed }), () => true)).toEqual({ kind: "quiet" });
  });

  test("an agent at work outranks the render that failed before it", () => {
    const failed: RenderState = { ...render, status: "failed" };

    expect(itemWork(summary({ render: failed, running: true }))).toEqual({ kind: "working" });
  });

  test("a running agent works on the request whose run is going", () => {
    const going = request("going", { run: run("running") });

    expect(itemWork(summary({ requests: [going], running: true }))).toEqual({
      kind: "working",
      request: going,
    });
    expect(itemWork(summary({ running: true }))).toEqual({ kind: "working" });
  });

  test("an agent that asks the board waits for the user before anything else", () => {
    const going = request("going", { run: run("running") });

    const work = itemWork(
      summary({ requests: [versions, going], running: true, approvals: 1, render }),
    );

    expect(work).toEqual({ kind: "approval", request: going });
    expect(needsYou(work)).toBe(true);
    expect(isBusy(work)).toBe(false);
    expect(itemWork(summary({ approvals: 1 }))).toEqual({ kind: "quiet" });
  });

  test("an agent that asks with its own tool waits for the answer, after a tool it asks for", () => {
    const going = request("going", { run: run("running") });
    const work = itemWork(summary({ requests: [versions, going], running: true, questions: 1 }));

    expect(work).toEqual({ kind: "question", request: going });
    expect(needsYou(work)).toBe(true);
    expect(itemWork(summary({ running: true, approvals: 1, questions: 1 })).kind).toBe("approval");
    expect(itemWork(summary({ questions: 1 }))).toEqual({ kind: "quiet" });
  });

  test("a finished run that left its request open with no result waits for an answer", () => {
    const asked = request("asked", { run: { ...run("done"), reply: "Above or below?" } });
    const work = itemWork(summary({ requests: [asked] }));

    expect(work).toEqual({ kind: "question", request: asked });
    expect(needsYou(work)).toBe(true);
    expect(itemWork(summary({ requests: [asked, versions] })).kind).toBe("versions");
    expect(itemWork(summary({ requests: [{ ...asked, status: "resolved" }] }))).toEqual({
      kind: "quiet",
    });
  });

  test("changed media waits to be looked at, and nothing else is quiet", () => {
    const changed = request("changed", { context: { before: "clip.mp4", after: "clip.mp4" } });

    expect(itemWork(summary({ requests: [changed] }))).toEqual({
      kind: "result",
      request: changed,
    });
    expect(itemWork(summary({ requests: [request("plain")] }))).toEqual({ kind: "quiet" });
  });
});

describe("byWork", () => {
  test("puts what needs the user first, then work, results, and the rest by change", () => {
    const tiles = [
      summary({ id: "quiet-old", updatedAt: 1 }),
      summary({ id: "working", running: true }),
      summary({ id: "quiet-new", updatedAt: 2 }),
      summary({ id: "versions", requests: [versions] }),
      summary({ id: "asking", running: true, approvals: 1 }),
    ].map((item) => ({ item, work: itemWork(item) }));

    expect(byWork(tiles).map((tile) => tile.item.id)).toEqual([
      "asking",
      "versions",
      "working",
      "quiet-new",
      "quiet-old",
    ]);
  });
});

describe("the sidebar's videos", () => {
  const items = [
    summary({ id: "quiet", updatedAt: 3 }),
    summary({ id: "done", status: "done", requests: [versions] }),
    summary({ id: "working", running: true, updatedAt: 1 }),
    summary({ id: "versions", requests: [versions], updatedAt: 2 }),
    summary({ id: "archived", status: "archived" }),
  ];

  test("lists the unfinished ones in the gallery's order", () => {
    expect(inProgress(items).map((tile) => tile.item.id)).toEqual(["versions", "working", "quiet"]);
  });

  test("counts every video that waits for the user, finished or not", () => {
    expect(waitingCount(items)).toBe(2);
    expect(
      waitingCount([summary({ requests: [{ ...versions, run: run("running") }], running: true })]),
    ).toBe(0);
  });
});

describe("attention", () => {
  test("counts what waits for the user and names the videos whose agent asks", () => {
    const items = [
      summary({ id: "asking", title: "Asking", running: true, approvals: 2 }),
      summary({ id: "versions", requests: [versions] }),
      summary({ id: "working", running: true }),
      summary({
        id: "question",
        title: "Question",
        requests: [request("asked", { run: run("done") })],
      }),
    ];

    expect(attention(items)).toEqual({
      waiting: 3,
      asking: [
        { id: "asking", title: "Asking", about: "approval" },
        { id: "question", title: "Question", about: "question" },
      ],
    });
  });
});
