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
  changeRows,
  describeChange,
  inUse,
  redoable,
  undoable,
  versionGroups,
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

const version = (id: string, file: string, at: string): MediaVersion => ({
  id,
  media: file,
  file: `history/${id}-${file}`,
  at,
  size: 1_000,
});

const doc = (
  entries: HistoryEntry[],
  cursor: number,
  versions: MediaVersion[] = [],
): HistoryDoc => ({
  cursor,
  entries,
  versions,
  heads: {},
});

const request = (id: string, body: string): Feedback => ({
  id,
  at: AT,
  author: "me",
  body,
  status: "open",
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

  test("rows list the newest change first, marking where the item is", () => {
    const rows = changeRows(doc(entries, 2));

    expect(rows.map((row) => [row.entry.id, row.state])).toEqual([
      ["c", "undone"],
      ["b", "now"],
      ["a", "done"],
    ]);
  });

  test("at the original nothing is current", () => {
    expect(changeRows(doc(entries, 0)).map((row) => row.state)).toEqual([
      "undone",
      "undone",
      "undone",
    ]);
  });
});

describe("change names", () => {
  test("an edit quotes the first line of its request, cut short", () => {
    const long = `${"Trim the pause before the punchline ".repeat(3)}\nand more`;
    const name = describeChange(media("a", { feedbackId: "f1" }), [request("f1", long)], en, "en");

    expect(name.startsWith("Edit “Trim the pause")).toBe(true);
    expect(name.endsWith("…”")).toBe(true);
    expect(name).not.toContain("and more");
  });

  test("an edit without its request names the file", () => {
    expect(describeChange(media("a", { feedbackId: "gone" }), [], en, "en")).toBe(
      "Edit to final.mp4",
    );
  });

  test("other media changes say why the file changed", () => {
    expect(describeChange(media("a", { cause: "restore" }), [], en, "en")).toBe(
      "Rolled back final.mp4",
    );
    expect(describeChange(media("a", { cause: "outside" }), [], en, "en")).toBe(
      "Changed final.mp4 outside a request",
    );
  });

  test("a single title or status change says what it became", () => {
    const renamed: HistoryEntry = {
      kind: "details",
      id: "d1",
      at: AT,
      before: { title: "Old" },
      after: { title: "New" },
    };

    const moved: HistoryEntry = {
      kind: "details",
      id: "d2",
      at: AT,
      before: { status: "drafting" },
      after: { status: "review" },
    };

    expect(describeChange(renamed, [], en, "en")).toBe("Renamed to “New”");
    expect(describeChange(moved, [], en, "en")).toBe(`Moved to ${en.status.review}`);
  });

  test("several fields, or a cleared one, are listed by name", () => {
    const several: HistoryEntry = {
      kind: "details",
      id: "d3",
      at: AT,
      before: { title: "Old", hook: null },
      after: { title: "New", hook: "Wait for it" },
    };

    const cleared: HistoryEntry = {
      kind: "details",
      id: "d4",
      at: AT,
      before: { notes: "Shoot at noon" },
      after: { notes: null },
    };

    expect(describeChange(several, [], en, "en")).toBe("Changed the title and hook");
    expect(describeChange(cleared, [], en, "en")).toBe("Changed the notes");
    expect(describeChange(several, [], ko, "ko")).toBe(
      ko.history.changed(`${ko.history.fields.title} 및 ${ko.history.fields.hook}`),
    );
  });
});

describe("saved versions", () => {
  test("group by file in first-saved order, newest version first", () => {
    const versions = [
      version("v1", "final.mp4", "2026-10-12T09:00:00.000Z"),
      version("v2", "cover.png", "2026-10-12T09:01:00.000Z"),
      version("v3", "final.mp4", "2026-10-12T09:02:00.000Z"),
    ];

    const groups = versionGroups(doc([], 0, versions));

    expect(groups.map((group) => [group.media, group.versions.map((v) => v.id)])).toEqual([
      ["final.mp4", ["v3", "v1"]],
      ["cover.png", ["v2"]],
    ]);
  });

  test("the version a file holds now is the one in use", () => {
    const current = version("v3", "final.mp4", AT);
    const older = version("v1", "final.mp4", AT);

    const history: HistoryDoc = {
      ...doc([], 0, [older, current]),
      heads: { "final.mp4": { version: "v3", size: 1_000, mtime: 0 } },
    };

    expect(inUse(history, current)).toBe(true);
    expect(inUse(history, older)).toBe(false);
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
