import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { InvalidRequest, NotFound, WorkspaceError } from "../src/core/errors.ts";
import {
  addFeedback,
  createItem,
  getItem,
  legacyStatus,
  listItemIds,
  openFeedback,
  resolveFeedback,
  updateItem,
  upsertSchedule,
} from "../src/core/items.ts";
import { Workspace } from "../src/core/workspace.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

describe("legacyStatus", () => {
  test("maps free-form status lines", () => {
    expect(legacyStatus("- status: published on TikTok", true)).toBe("published");
    expect(legacyStatus("- status: scheduled 2026-05-01", true)).toBe("scheduled");
    expect(legacyStatus("- Status: ready-to-schedule", true)).toBe("approved");
    expect(legacyStatus("* status: in review", true)).toBe("review");
    expect(legacyStatus("- status: draft", false)).toBe("drafting");
    expect(legacyStatus("# Notes", true)).toBe("review");
    expect(legacyStatus("", false)).toBe("idea");
  });
});

describe("items in a workspace", () => {
  let t: TestWorkspace;

  beforeEach(async () => {
    t = await makeWorkspace();
  });

  afterEach(() => t.remove());

  test("writes to one item at the same time keep each other's changes", async () => {
    const bodies = Array.from({ length: 12 }, (_, n) => `Note ${n}`);

    const item = await t.run(
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Busy" });
        yield* Effect.forEach(bodies, (body) => addFeedback(created.id, { body }), {
          concurrency: "unbounded",
        });

        return yield* getItem(created.id);
      }),
    );

    expect(item.doc.feedback.map((f) => f.body).toSorted()).toEqual(bodies.toSorted());
  });

  test("creates, updates, and dedupes ids", async () => {
    const [a, b, updated, merged] = await t.run(
      Effect.gen(function* () {
        const first = yield* createItem({ title: "Fried Liver Trap", format: "trap" });
        const second = yield* createItem({ title: "Fried Liver Trap", format: "trap" });

        const reviewed = yield* updateItem(first.id, {
          status: "review",
          platforms: { tiktok: { caption: "one" } },
        });

        const tagged = yield* updateItem(first.id, {
          platforms: { tiktok: { hashtags: ["#chess"] } },
        });

        return [first, second, reviewed, tagged] as const;
      }),
    );

    expect([a.id, b.id]).toEqual(["trap/fried-liver-trap", "trap/fried-liver-trap-2"]);
    expect(updated.doc.status).toBe("review");
    expect(merged.doc.platforms.tiktok).toEqual({ caption: "one", hashtags: ["#chess"] });
  });

  test("rejects a blank title and an id that climbs out of the items folder", async () => {
    expect(await t.fail(createItem({ title: "   " }))).toBeInstanceOf(InvalidRequest);
    expect(await t.fail(createItem({ title: "x", id: "../escape" }))).toBeInstanceOf(
      InvalidRequest,
    );
    expect(await t.fail(getItem("missing/item"))).toBeInstanceOf(NotFound);
  });

  test("feedback reopens approved items and resolves", async () => {
    const { reopened, open, after } = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Hook test" });
        yield* updateItem(item.id, { status: "approved" });

        const added = yield* addFeedback(item.id, {
          body: "Hook is too slow",
          media: "[9x16] video.mp4",
          timecode: 1.2,
        });

        const listed = yield* openFeedback();
        yield* resolveFeedback(item.id, added.feedback.id, "Cut the intro");

        return { reopened: added.item, open: listed, after: yield* openFeedback() };
      }),
    );

    expect(reopened.doc.status).toBe("review");
    expect(open.map((entry) => entry.feedback.timecode)).toEqual([1.2]);
    expect(after).toEqual([]);
  });

  test("feedback needs a message and a known entry to resolve", async () => {
    const id = await t.run(Effect.map(createItem({ title: "Quiet" }), (item) => item.id));

    expect(await t.fail(addFeedback(id, { body: "  " }))).toBeInstanceOf(InvalidRequest);
    expect(await t.fail(resolveFeedback(id, "nope", "done"))).toBeInstanceOf(NotFound);
  });

  test("schedule entries drive status", async () => {
    const at = "2026-10-12T19:00:00+09:00";

    const { scheduled, done } = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Post" });
        yield* upsertSchedule(item.id, { platform: "tiktok", at, status: "scheduled" });
        const pending = yield* getItem(item.id);

        const published = yield* upsertSchedule(item.id, {
          platform: "tiktok",
          at,
          status: "published",
        });

        return { scheduled: pending, done: published };
      }),
    );

    expect(scheduled.doc.status).toBe("scheduled");
    expect(done.doc.status).toBe("published");
    expect(done.doc.schedule).toHaveLength(1);
  });

  test("discovers legacy folders and upgrades them on write", async () => {
    const dir = join(t.root, "items/lessons/caro-kann");
    await mkdir(join(dir, "frames"), { recursive: true });
    await writeFile(join(dir, "POSTING.md"), "# Caro-Kann Posting\n");
    await writeFile(join(dir, "STATUS.md"), "- status: ready-to-post\n");
    await writeFile(join(dir, "[1x1] 01-hook.jpg"), "");

    const { ids, legacy, upgraded } = await t.run(
      Effect.gen(function* () {
        const found = yield* listItemIds();
        const before = yield* getItem("lessons/caro-kann");
        const added = yield* addFeedback(before.id, { body: "Bigger board" });

        return { ids: found, legacy: before, upgraded: added.item };
      }),
    );

    expect(ids).toEqual(["lessons/caro-kann"]);
    expect([legacy.legacy, legacy.doc.title, legacy.doc.status]).toEqual([
      true,
      "Caro-Kann",
      "approved",
    ]);
    expect(legacy.media.map((m) => [m.name, m.aspect])).toEqual([["[1x1] 01-hook.jpg", "1x1"]]);
    expect(upgraded.legacy).toBe(false);
    expect(upgraded.doc.title).toBe("Caro-Kann");
  });

  test("refuses paths that escape the workspace", async () => {
    const escape = Workspace.use((ws) => ws.abs("../outside"));

    expect(await t.fail(escape)).toBeInstanceOf(WorkspaceError);
  });

  test("a marked folder with child items is a series, not an item", async () => {
    await mkdir(join(t.root, "items/guides/indexes/by-style"), { recursive: true });
    await writeFile(join(t.root, "items/guides/indexes/STATUS.md"), "# Indexes status\n");
    await writeFile(
      join(t.root, "items/guides/indexes/by-style/STATUS.md"),
      "# By style — status\n- status: published\n",
    );

    const { ids, title } = await t.run(
      Effect.gen(function* () {
        const found = yield* listItemIds();
        const item = yield* getItem("guides/indexes/by-style");

        return { ids: found, title: item.doc.title };
      }),
    );

    expect(ids).toEqual(["guides/indexes/by-style"]);
    expect(title).toBe("By style");
  });
});
