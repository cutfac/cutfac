import { describe, expect, test } from "bun:test";

import type { AgentRun, Feedback, ItemDetail } from "../web/src/api.ts";
import { hasResult, inOrder, linePaused, pinsOn, waitingLine } from "../web/src/lib/requests.ts";
import { NO_RUN, type LiveRun } from "../web/src/lib/run.ts";

const at = (second: number) => new Date(Date.UTC(2026, 9, 14, 0, 0, second)).toISOString();

const request = (id: string, second: number, extra: Partial<Feedback> = {}): Feedback => ({
  id,
  at: at(second),
  author: "user",
  body: `request ${id}`,
  media: "clip.mp4",
  status: "open",
  ...extra,
});

const saved = (status: AgentRun["status"]): AgentRun => ({
  agent: "claude",
  status,
  startedAt: at(0),
});

function itemWith(feedback: Feedback[], extra: Partial<ItemDetail> = {}): ItemDetail {
  return {
    id: "item",
    dir: "items/item",
    legacy: false,
    running: false,
    media: [{ name: "clip.mp4", kind: "video", size: 1, mtime: Date.parse(at(0)) }],
    docs: {},
    doc: {
      title: "Item",
      status: "idea",
      sources: [],
      platforms: {},
      schedule: [],
      metrics: [],
      feedback,
    },
    history: { cursor: 0, entries: [], versions: [], heads: {} },
    reviews: [],
    updatedAt: 0,
    ...extra,
  };
}

const live = (subject: string, status: LiveRun["status"]): LiveRun => ({
  ...NO_RUN,
  subject,
  agent: "claude",
  status,
});

describe("the request line", () => {
  test("numbers requests in the order they were made and lines up the open waiting ones", () => {
    const item = itemWith([
      request("c", 3, { waiting: "claude" }),
      request("a", 1),
      request("d", 4, { waiting: "codex", status: "resolved" }),
      request("b", 2, { waiting: "claude" }),
    ]);

    const requests = inOrder(item);

    expect(requests.map((feedback) => feedback.id)).toEqual(["a", "b", "c", "d"]);
    expect(waitingLine(requests).map((feedback) => feedback.id)).toEqual(["b", "c"]);
  });

  test("is paused only when requests wait and nothing is about to take them", () => {
    const waiting = itemWith([request("a", 1), request("b", 2, { waiting: "claude" })]);

    expect(linePaused(itemWith([request("a", 1)]), NO_RUN)).toBe(false);
    expect(linePaused({ ...waiting, running: true }, NO_RUN)).toBe(false);
    expect(linePaused(waiting, live("a", "running"))).toBe(false);
    // The run before finished its work: the next one is about to start.
    expect(linePaused(waiting, live("a", "done"))).toBe(false);
    expect(linePaused(waiting, live("a", "failed"))).toBe(true);
    expect(linePaused(waiting, live("a", "stopped"))).toBe(true);
    // After a restart nothing streams, so nothing will pick the line up on its own.
    expect(linePaused(waiting, NO_RUN)).toBe(true);
  });
});

describe("hasResult", () => {
  const before = { before: "edits/a/before.mp4" };

  test("needs a run that began and no decision yet", () => {
    const changed = { media: [{ name: "clip.mp4", kind: "video" as const, size: 1, mtime: 9e15 }] };

    expect(hasResult(itemWith([], changed), request("a", 1), false)).toBe(false);
    expect(hasResult(itemWith([], changed), request("a", 1, { context: before }), true)).toBe(
      false,
    );
    expect(
      hasResult(
        itemWith([], changed),
        request("a", 1, { context: before, decision: "approved" }),
        false,
      ),
    ).toBe(false);
    expect(hasResult(itemWith([], changed), request("a", 1, { context: before }), false)).toBe(
      true,
    );
  });

  test("counts a saved result even when the media did not change", () => {
    const feedback = request("a", 1, { context: { ...before, after: "edits/a/after.mp4" } });

    expect(hasResult(itemWith([]), feedback, false)).toBe(true);
  });

  test("counts a request that waited from when its turn came", () => {
    const item = itemWith([], {
      media: [{ name: "clip.mp4", kind: "video", size: 1, mtime: Date.parse(at(5)) }],
    });

    // Written after the request was made, but by the run before it.
    expect(hasResult(item, request("b", 2, { context: before, baseline: at(6) }), false)).toBe(
      false,
    );
    expect(hasResult(item, request("b", 2, { context: before, baseline: at(4) }), false)).toBe(
      true,
    );
  });
});

describe("pinsOn", () => {
  test("pins the requests in play on the shown media with their chat numbers", () => {
    const item = itemWith([
      request("done", 1, { status: "resolved", run: saved("done") }),
      request("working", 2, { run: saved("running"), context: { before: "x" } }),
      request("other", 3, { media: "cover.png", waiting: "claude" }),
      request("waiting", 4, { waiting: "claude" }),
      request("failed", 5, { run: saved("failed") }),
      request("review", 6, { run: saved("done"), context: { before: "x", after: "y" } }),
      request("kept", 7, { run: saved("done"), decision: "approved", context: { before: "x" } }),
      request("unsent", 8),
    ]);

    const pins = pinsOn(item, "clip.mp4", live("working", "running"));

    expect(pins.map(({ feedback, number, state }) => [feedback.id, number, state])).toEqual([
      ["working", 2, "working"],
      ["waiting", 4, "waiting"],
      ["failed", 5, "halted"],
      ["review", 6, "review"],
    ]);
    expect(pinsOn(item, "cover.png", NO_RUN).map((pin) => pin.number)).toEqual([3]);
  });

  test("shows a run cut off by a restart as halted", () => {
    const item = itemWith([request("a", 1, { run: saved("running") })]);

    expect(pinsOn(item, "clip.mp4", NO_RUN).map((pin) => pin.state)).toEqual(["halted"]);
    expect(pinsOn({ ...item, running: true }, "clip.mp4", NO_RUN).map((pin) => pin.state)).toEqual([
      "working",
    ]);
  });
});
