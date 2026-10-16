import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect, Schema } from "effect";

import { InvalidRequest, NotFound, WorkspaceError } from "../src/core/errors.ts";
import {
  addFeedback,
  createItem,
  getItem,
  listItemIds,
  openFeedback,
  resolveFeedback,
  updateItem,
  upgradeItemDoc,
} from "../src/core/items.ts";
import { currentStatus, DetailValues } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

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
    expect(upgradeItemDoc({ ...doc, caption: " Start strong " }).notes).toBe(
      "Caption: Start strong",
    );
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
        const first = yield* createItem({ title: "Monstera Repot", format: "howto" });
        const second = yield* createItem({ title: "Monstera Repot", format: "howto" });

        const reviewed = yield* updateItem(first.id, { status: "review", hook: "One step" });
        const noted = yield* updateItem(first.id, { notes: "Film it on a wooden table" });

        return [first, second, reviewed, noted] as const;
      }),
    );

    expect([a.id, b.id]).toEqual(["howto/monstera-repot", "howto/monstera-repot-2"]);
    expect(updated.doc.status).toBe("review");
    expect([merged.doc.hook, merged.doc.notes]).toEqual(["One step", "Film it on a wooden table"]);
  });

  test("an explicit id brings in a folder without item.yaml, unless it holds items", async () => {
    const dir = join(t.root, "items/lessons/repotting");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notes.md"), "# Repotting\n");
    await writeFile(join(dir, "[1x1] 01-hook.jpg"), "");
    await mkdir(join(t.root, "items/guides/watering"), { recursive: true });
    await writeFile(join(t.root, "items/guides/watering/item.yaml"), "title: Watering\n");

    const [adopted, group] = await t.run(
      Effect.all([
        createItem({ title: "Repotting", id: "lessons/repotting" }),
        createItem({ title: "Guides", id: "guides" }),
      ]),
    );

    expect([adopted.id, adopted.doc.title, adopted.docs]).toEqual([
      "lessons/repotting",
      "Repotting",
      ["notes.md"],
    ]);
    expect(adopted.media.map((m) => m.name)).toEqual(["[1x1] 01-hook.jpg"]);
    expect(await Bun.file(join(dir, "item.yaml")).exists()).toBe(true);
    expect(group.id).toBe("guides-2");
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
    const dir = join(t.root, "items/posts/intro");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "item.yaml"),
      "title: Intro\nstatus: review\nnotes: Keep it short\ncaption: Three tips in 30 seconds\n",
    );

    const { read, written } = await t.run(
      Effect.gen(function* () {
        const before = yield* getItem("posts/intro");
        yield* updateItem(before.id, { hook: "Start strong" });

        return { read: before, written: yield* getItem(before.id) };
      }),
    );

    expect(read.doc.notes).toBe("Keep it short\n\nCaption: Three tips in 30 seconds");
    expect(written.doc.notes).toBe("Keep it short\n\nCaption: Three tips in 30 seconds");
    expect(await Bun.file(join(dir, "item.yaml")).text()).not.toContain("caption:");
  });

  test("a status from an earlier version reads as its successor and is written as one", async () => {
    const dir = join(t.root, "items/posts/intro");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "item.yaml"), "title: Intro\nstatus: published\n");

    const read = await t.run(
      Effect.gen(function* () {
        const before = yield* getItem("posts/intro");
        yield* updateItem(before.id, { hook: "Start strong" });

        return before;
      }),
    );

    expect(read.doc.status).toBe("done");
    expect(await Bun.file(join(dir, "item.yaml")).text()).toContain("status: done");
  });

  test("refuses paths that escape the workspace", async () => {
    const escape = Workspace.use((ws) => ws.abs("../outside"));

    expect(await t.fail(escape)).toBeInstanceOf(WorkspaceError);
  });

  test("only folders with item.yaml are items; other folders group them", async () => {
    const dir = join(t.root, "items/lessons/repotting");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "notes.md"), "# Repotting\n");
    await mkdir(join(t.root, "items/guides/by-style"), { recursive: true });
    await writeFile(join(t.root, "items/guides/notes.md"), "# Guides\n");
    await writeFile(join(t.root, "items/guides/by-style/item.yaml"), "title: By style\n");

    const ids = await t.run(listItemIds());

    expect(ids).toEqual(["guides/by-style"]);
    expect(await t.fail(getItem("lessons/repotting"))).toBeInstanceOf(NotFound);
  });
});
