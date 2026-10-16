import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Schema } from "effect";

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
  upgradeItemDoc,
} from "../src/core/items.ts";
import { currentStatus, DetailValues } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

describe("legacyStatus", () => {
  test("maps free-form status lines", () => {
    expect(legacyStatus("- status: published on TikTok", true)).toBe("done");
    expect(legacyStatus("- status: scheduled 2026-05-01", true)).toBe("done");
    expect(legacyStatus("- Status: ready-to-schedule", true)).toBe("done");
    expect(legacyStatus("- status: approved, archived", true)).toBe("archived");
    expect(legacyStatus("* status: in review", true)).toBe("review");
    expect(legacyStatus("- status: draft", false)).toBe("drafting");
    expect(legacyStatus("# Notes", true)).toBe("review");
    expect(legacyStatus("", false)).toBe("drafting");
  });
});

describe("currentStatus", () => {
  test("reads earlier versions' statuses as the ones that replaced them", () => {
    expect((["idea", "approved", "scheduled", "published"] as const).map(currentStatus)).toEqual([
      "drafting",
      "done",
      "done",
      "done",
    ]);
    expect((["drafting", "review", "done", "archived"] as const).map(currentStatus)).toEqual([
      "drafting",
      "review",
      "done",
      "archived",
    ]);
  });

  test("history entries from earlier versions still decode", () => {
    expect(Schema.decodeSync(DetailValues)({ status: "approved" })).toEqual({
      status: "done",
    });
  });
});

describe("upgradeItemDoc", () => {
  const doc = { title: "Clip", status: "review", sources: [], feedback: [], sessions: {} } as const;

  test("starts the notes with a caption when there were none, and drops a blank one", () => {
    expect(upgradeItemDoc({ ...doc, caption: " Win fast " }).notes).toBe("Caption: Win fast");
    expect(upgradeItemDoc({ ...doc, caption: "  " })).toEqual(doc);
    expect(upgradeItemDoc(doc)).toEqual(doc);
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

        const reviewed = yield* updateItem(first.id, { status: "review", hook: "One move" });
        const noted = yield* updateItem(first.id, { notes: "Film it on a wooden board" });

        return [first, second, reviewed, noted] as const;
      }),
    );

    expect([a.id, b.id]).toEqual(["trap/fried-liver-trap", "trap/fried-liver-trap-2"]);
    expect(updated.doc.status).toBe("review");
    expect([merged.doc.hook, merged.doc.notes]).toEqual(["One move", "Film it on a wooden board"]);
  });

  test("rejects a blank title and an id that climbs out of the items folder", async () => {
    expect(await t.fail(createItem({ title: "   " }))).toBeInstanceOf(InvalidRequest);
    expect(await t.fail(createItem({ title: "x", id: "../escape" }))).toBeInstanceOf(
      InvalidRequest,
    );
    expect(await t.fail(getItem("missing/item"))).toBeInstanceOf(NotFound);
  });

  test("feedback reopens done items and resolves", async () => {
    const { reopened, open, after } = await t.run(
      Effect.gen(function* () {
        const item = yield* createItem({ title: "Hook test" });
        yield* updateItem(item.id, { status: "done" });

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

  test("a caption from an earlier version moves into the notes and stays there", async () => {
    const dir = join(t.root, "items/posts/opening");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "item.yaml"),
      "title: Opening\nstatus: review\nnotes: Keep it short\ncaption: Three moves to win\n",
    );

    const { read, written } = await t.run(
      Effect.gen(function* () {
        const before = yield* getItem("posts/opening");
        yield* updateItem(before.id, { hook: "Win fast" });

        return { read: before, written: yield* getItem(before.id) };
      }),
    );

    expect(read.doc.notes).toBe("Keep it short\n\nCaption: Three moves to win");
    expect(written.doc.notes).toBe("Keep it short\n\nCaption: Three moves to win");
    expect(await Bun.file(join(dir, "item.yaml")).text()).not.toContain("caption:");
  });

  test("a status from an earlier version reads as its successor and is written as one", async () => {
    const dir = join(t.root, "items/posts/opening");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "item.yaml"), "title: Opening\nstatus: published\n");

    const read = await t.run(
      Effect.gen(function* () {
        const before = yield* getItem("posts/opening");
        yield* updateItem(before.id, { hook: "Win fast" });

        return before;
      }),
    );

    expect(read.doc.status).toBe("done");
    expect(await Bun.file(join(dir, "item.yaml")).text()).toContain("status: done");
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
      "done",
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
