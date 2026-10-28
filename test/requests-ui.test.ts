import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import { MAX_VARIANTS } from "../src/core/schema.ts";
import type { AgentRun, EditReceipt, Feedback, ItemDetail } from "../web/src/api.ts";
import {
  asksUser,
  hasResult,
  inOrder,
  linePaused,
  MAX_VARIANTS as BOARD_MAX_VARIANTS,
  pinsOn,
  runOffer,
  versionsMedia,
  versionsOf,
  waitingLine,
} from "../web/src/lib/requests.ts";
import { liveFor, NO_RUN, sendingRun, sentRun, type LiveRun } from "../web/src/lib/run.ts";

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
    running: false,
    media: [{ name: "clip.mp4", kind: "video", size: 1, mtime: Date.parse(at(0)) }],
    docs: {},
    doc: {
      title: "Item",
      status: "drafting",
      sources: [],
      sessions: {},
      feedback,
    },
    history: { cursor: 0, entries: [], versions: [], heads: {} },
    reviews: [],
    references: [],
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

  test("counts versions saved to compare until the user picks one", () => {
    const version = { id: "v1", label: "Big captions", file: "edits/a/variants/v1.mp4", at: at(3) };
    const variants = { wanted: 2, media: "clip.mp4", saved: [version] };
    const open = request("a", 1, { context: before, variants });
    const picked = { ...open, decision: "approved" as const };

    expect(versionsOf(open)).toEqual([version]);
    expect(hasResult(itemWith([]), open, false)).toBe(true);
    expect(hasResult(itemWith([]), open, true)).toBe(false);
    expect(versionsOf(picked)).toEqual([]);
    expect(hasResult(itemWith([]), picked, false)).toBe(false);
  });

  test("shows the versions of the media they were saved from", () => {
    const variants = { media: "cover.png", saved: [] };

    expect(versionsMedia(request("a", 1, { variants }))).toEqual(Option.some("cover.png"));
    expect(versionsMedia(request("b", 1))).toEqual(Option.some("clip.mp4"));
  });

  test("offers as many versions as the server holds", () => {
    expect(BOARD_MAX_VARIANTS).toBe(MAX_VARIANTS);
  });
});

describe("asksUser", () => {
  const done = { status: Option.some("done" as const), running: false };

  test("is a finished run whose open request has no result to look at", () => {
    const asked = request("a", 1, { run: saved("done") });

    expect(asksUser(itemWith([asked]), asked, done)).toBe(true);
    expect(asksUser(itemWith([asked]), asked, { ...done, running: true })).toBe(false);
    expect(
      asksUser(itemWith([asked]), asked, { status: Option.some("failed"), running: false }),
    ).toBe(false);
    expect(asksUser(itemWith([asked]), { ...asked, status: "resolved" }, done)).toBe(false);

    const changed = { media: [{ name: "clip.mp4", kind: "video" as const, size: 1, mtime: 9e15 }] };
    const edited = { ...asked, context: { before: "edits/a/before.mp4" } };

    expect(asksUser(itemWith([edited], changed), edited, done)).toBe(false);
  });
});

describe("runOffer", () => {
  const idle = { status: Option.none(), running: false };

  test("offers to send a request nothing ran yet, and to run a halted one again", () => {
    expect(runOffer(true, idle, false)).toEqual(Option.some("send"));
    expect(runOffer(true, { status: Option.some("failed"), running: false }, false)).toEqual(
      Option.some("retry"),
    );
    expect(runOffer(true, { status: Option.some("stopped"), running: false }, false)).toEqual(
      Option.some("retry"),
    );
  });

  test("offers nothing while it runs, after it finished, or once it is closed", () => {
    expect(runOffer(true, { status: Option.some("running"), running: true }, false)).toEqual(
      Option.none(),
    );
    expect(runOffer(true, { status: Option.some("done"), running: false }, false)).toEqual(
      Option.none(),
    );
    expect(runOffer(false, idle, false)).toEqual(Option.none());
  });

  test("offers nothing once a result came in, from the user's own agent too", () => {
    expect(runOffer(true, idle, true)).toEqual(Option.none());
    expect(runOffer(true, { status: Option.some("failed"), running: false }, true)).toEqual(
      Option.none(),
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

const receipt = (feedback: Feedback, sent: EditReceipt["sent"] = "claude"): EditReceipt => ({
  item: itemWith([feedback], { running: true }),
  feedbackId: feedback.id,
  sent,
  warnings: [],
  prompt: "",
});

describe("sent request", () => {
  const picked = { model: "opus", effort: "max" };

  test("shows as working before the stream reports it", () => {
    expect(sentRun(NO_RUN, receipt(request("f1", 1)), picked)).toEqual({
      ...NO_RUN,
      subject: "f1",
      agent: "claude",
      model: "opus",
      effort: "max",
      status: "running",
    });
  });

  test("keeps what the stream already reported", () => {
    const streamed: LiveRun = {
      ...live("f1", "running"),
      steps: [{ kind: "text", text: "On it." }],
    };

    expect(sentRun(streamed, receipt(request("f1", 1)), picked)).toBe(streamed);
  });

  test("starts nothing when lined up or sent to no agent", () => {
    const earlier = live("f0", "running");

    expect(sentRun(earlier, receipt(request("f1", 1, { waiting: "claude" })), picked)).toBe(
      earlier,
    );
    expect(sentRun(NO_RUN, receipt(request("f1", 1), "queue"), picked)).toBe(NO_RUN);
  });
});

describe("request on its way", () => {
  const input = { body: "Shorter", agent: "claude", model: "opus" } as const;
  const old = request("f0", 0, { run: saved("done") });

  test("shows the new request as working until the server answers", () => {
    const sending = sendingRun(NO_RUN, itemWith([old]), input);
    const fresh = request("f1", 1);

    expect(liveFor(sending, fresh)).toEqual(
      Option.some({
        ...NO_RUN,
        subject: "f1",
        agent: "claude",
        model: "opus",
        effort: undefined,
        status: "running",
      }),
    );
    // The requests that were there before the send stay as they were.
    expect(liveFor(sending, old)).toEqual(Option.none());
    expect(liveFor(sending, request("f1", 1, { waiting: "claude" }))).toEqual(Option.none());

    const answered = sentRun(sending, receipt(fresh), input);

    expect(answered.sending).toBeUndefined();
    expect(Option.map(liveFor(answered, fresh), (run) => run.status)).toEqual(
      Option.some("running"),
    );
  });

  test("marks nothing for no agent or behind a run going now", () => {
    const busy = live("f0", "running");

    expect(sendingRun(NO_RUN, itemWith([old]), { ...input, agent: "queue" })).toBe(NO_RUN);
    expect(sendingRun(busy, itemWith([old]), input)).toBe(busy);
    expect(sendingRun(NO_RUN, itemWith([old], { running: true }), input)).toBe(NO_RUN);
  });

  test("forgets the send when the request lines up instead", () => {
    const sending = sendingRun(NO_RUN, itemWith([old]), input);
    const lined = sentRun(sending, receipt(request("f1", 1, { waiting: "claude" })), input);

    expect(lined).toEqual(NO_RUN);
  });
});
