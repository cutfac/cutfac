import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import type {
  Feedback,
  HistoryDoc,
  HistoryEntry,
  MediaChange,
  MediaVersion,
} from "../web/src/api.ts";
import { en } from "../web/src/i18n/en.tsx";
import { ko } from "../web/src/i18n/ko.tsx";
import {
  describeVersion,
  originOf,
  pointOf,
  quote,
  redoable,
  undoable,
  versionDays,
} from "../web/src/lib/history.ts";
import { formatAgo } from "../web/src/lib/time.ts";

const AT = "2026-10-12T09:00:00.000Z";

const media = (id: string, overrides: Partial<MediaChange> = {}): MediaChange => ({
  kind: "media",
  id,
  at: AT,
  media: "final.mp4",
  from: "v1",
  to: "v2",
  cause: "edit",
  ...overrides,
});

const version = (id: string, overrides: Partial<MediaVersion> = {}): MediaVersion => ({
  id,
  media: "final.mp4",
  file: `history/${id}.mp4`,
  at: AT,
  size: 1_000,
  ...overrides,
});

const doc = (
  entries: HistoryEntry[],
  cursor: number,
  versions: MediaVersion[] = [],
  heads: HistoryDoc["heads"] = {},
): HistoryDoc => ({ cursor, entries, versions, heads });

const holding = (id: string) => ({ "final.mp4": { version: id, size: 1_000, mtime: 0 } });

const request = (id: string, overrides: Partial<Feedback> = {}): Feedback => ({
  id,
  at: AT,
  author: "me",
  body: "Punchier",
  status: "resolved",
  decision: "approved",
  media: "final.mp4",
  ...overrides,
});

describe("undo stack", () => {
  const entries = [media("a"), media("b"), media("c")];

  test("undo takes back the change before the cursor, redo makes the one after it again", () => {
    const history = doc(entries, 2);

    expect(Option.map(undoable(history), ({ id }) => id)).toEqual(Option.some("b"));
    expect(Option.map(redoable(history), ({ id }) => id)).toEqual(Option.some("c"));
    expect(undoable(doc(entries, 0))).toEqual(Option.none());
    expect(redoable(doc(entries, 3))).toEqual(Option.none());
  });
});

describe("version names", () => {
  test("a request is quoted by its first line, cut short", () => {
    const long = `${"Trim the pause before the punchline ".repeat(3)}\nand more`;
    const name = quote(long);

    expect(name.startsWith("Trim the pause")).toBe(true);
    expect(name.endsWith("…")).toBe(true);
    expect(name).not.toContain("and more");
  });

  test("a pick is named by the version picked, any other by what put it in", () => {
    expect(describeVersion({ cause: "edit", variant: "v2: Fast cuts" }, en)).toBe("v2: Fast cuts");
    expect(describeVersion({ cause: "edit" }, en)).toBe("Agent's edit");
    expect(describeVersion({ cause: "original" }, en)).toBe("Original");
    expect(describeVersion({ cause: undefined }, en)).toBe("Earlier version");
  });

  test("the file is named only when the item has others to tell it from", () => {
    expect(describeVersion({ cause: "restore" }, en)).toBe("Rolled back to before");
    expect(describeVersion({ cause: "restore" }, en, "final.mp4")).toBe(
      "Rolled final.mp4 back to before",
    );
    expect(describeVersion({ cause: "outside" }, ko, "final.mp4")).toBe(
      "final.mp4가 요청 밖에서 바뀜",
    );
  });

  test("a version saved before versions said what made them is told by its change", () => {
    const history = doc([media("a", { from: "v1", to: "v2", feedbackId: "f1" })], 1, [
      version("v1"),
      version("v2"),
      version("v3"),
    ]);

    const [first, second, third] = history.versions.map((v) => originOf(history, v));

    expect(first).toEqual({ cause: "original" });
    expect(second).toEqual({ cause: "edit", feedbackId: "f1" });
    expect(third).toEqual({ cause: undefined });
  });
});

const dayOf = (at: string) => at.slice(0, 10);

const on = (date: string) => `${date}T09:00:00.000Z`;

describe("one log of versions", () => {
  test("lists them newest first by day, with a request's versions in a row together", () => {
    const versions = [
      version("original", { cause: "original", at: on("2026-10-11") }),
      version("pick", { cause: "edit", feedbackId: "f1", at: on("2026-10-11") }),
      version("switch", { cause: "edit", feedbackId: "f1", at: on("2026-10-12") }),
      version("back", { cause: "version", source: "pick", at: on("2026-10-12") }),
      version("edit", { cause: "edit", feedbackId: "f2", at: on("2026-10-12") }),
      version("again", { cause: "edit", feedbackId: "f2", at: on("2026-10-12") }),
    ];

    const days = versionDays(doc([], 0, versions), dayOf);

    expect(
      days.map(({ day, blocks }) => [
        day,
        blocks.map((block) => [block.feedbackId, block.versions.map(({ id }) => id)]),
      ]),
    ).toEqual([
      [
        "2026-10-12",
        [
          ["f2", ["again", "edit"]],
          [undefined, ["back"]],
          ["f1", ["switch"]],
        ],
      ],
      [
        "2026-10-11",
        [
          ["f1", ["pick"]],
          [undefined, ["original"]],
        ],
      ],
    ]);
  });

  test("a kept request goes back to the last version it put in, unless the file has it", () => {
    const versions = [
      version("original", { cause: "original" }),
      version("first", { cause: "edit", feedbackId: "f1" }),
      version("picked", { cause: "edit", feedbackId: "f1", file: "edits/f1/kept-a.mp4" }),
      version("later", { cause: "edit", feedbackId: "f2" }),
      // Rolling f2 back put f1's content back from f2's own copy.
      version("rolled", {
        cause: "restore",
        feedbackId: "f2",
        file: "edits/f2/before.mp4",
        source: "picked",
      }),
    ];

    const at = (held: string) => doc([], 0, versions, holding(held));
    const pointed = (held: string, f: Feedback) => Option.map(pointOf(at(held), f), ({ id }) => id);

    expect(pointed("later", request("f1"))).toEqual(Option.some("picked"));
    expect(pointed("picked", request("f1"))).toEqual(Option.none());
    expect(pointed("rolled", request("f1"))).toEqual(Option.none());
    expect(pointed("original", request("f1", { decision: "restored" }))).toEqual(Option.none());
  });
});

describe("relative time", () => {
  const now = Date.parse(AT);

  test("picks the largest unit that fits", () => {
    expect(formatAgo(new Date(now - 5 * 60_000).toISOString(), "en", now)).toBe("5 minutes ago");
    expect(formatAgo(new Date(now - 3 * 3_600_000).toISOString(), "en", now)).toBe("3 hours ago");
    expect(formatAgo(new Date(now - 86_400_000).toISOString(), "en", now)).toBe("yesterday");
  });

  test("speaks the board's language", () => {
    expect(formatAgo(new Date(now - 5 * 60_000).toISOString(), "ko", now)).toBe("5분 전");
  });

  test("anything under a minute is now, so the label does not tick", () => {
    expect(formatAgo(AT, "en", now)).toBe("now");
    expect(formatAgo(new Date(now - 59_000).toISOString(), "en", now)).toBe("now");
  });
});
