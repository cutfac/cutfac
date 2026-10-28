import { describe, expect, test } from "bun:test";

import { Effect, Schema } from "effect";

import { InvalidRequest, NotFound, WorkspaceError } from "../src/core/errors.ts";
import { DetailValues } from "../src/core/historySchema.ts";
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
import { currentStatus } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

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
  it.live("writes to one item at the same time keep each other's changes", () =>
    Effect.gen(function* () {
      const bodies = Array.from({ length: 12 }, (_, n) => `Note ${n}`);
      const created = yield* createItem({ title: "Busy" });

      yield* Effect.forEach(bodies, (body) => addFeedback(created.id, { body }), {
        concurrency: "unbounded",
      });

      const item = yield* getItem(created.id);

      expect(item.doc.feedback.map((f) => f.body).toSorted()).toEqual(bodies.toSorted());
    }),
  );

  it.live("creates, updates, and dedupes ids", () =>
    Effect.gen(function* () {
      const a = yield* createItem({ title: "Monstera Repot", format: "howto" });
      const b = yield* createItem({ title: "Monstera Repot", format: "howto" });

      const updated = yield* updateItem(a.id, { status: "review", hook: "One step" });
      const merged = yield* updateItem(a.id, { notes: "Film it on a wooden table" });

      expect([a.id, b.id]).toEqual(["howto/monstera-repot", "howto/monstera-repot-2"]);
      expect(updated.doc.status).toBe("review");
      expect([merged.doc.hook, merged.doc.notes]).toEqual([
        "One step",
        "Film it on a wooden table",
      ]);
    }),
  );

  it.live("an explicit id brings in a folder without item.yaml, unless it holds items", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const dir = "items/lessons/repotting";

      yield* ws.writeText(`${dir}/notes.md`, "# Repotting\n");
      yield* ws.writeText(`${dir}/[1x1] 01-hook.jpg`, "");
      yield* ws.writeText("items/guides/watering/item.yaml", "title: Watering\n");

      const [adopted, group] = yield* Effect.all([
        createItem({ title: "Repotting", id: "lessons/repotting" }),
        createItem({ title: "Guides", id: "guides" }),
      ]);

      expect([adopted.id, adopted.doc.title, adopted.docs]).toEqual([
        "lessons/repotting",
        "Repotting",
        ["notes.md"],
      ]);
      expect(adopted.media.map((m) => m.name)).toEqual(["[1x1] 01-hook.jpg"]);
      expect(yield* ws.exists(`${dir}/item.yaml`)).toBe(true);
      expect(group.id).toBe("guides-2");
    }),
  );

  it.live("rejects a blank title and an id that climbs out of the items folder", () =>
    Effect.gen(function* () {
      expect(yield* Effect.flip(createItem({ title: "   " }))).toBeInstanceOf(InvalidRequest);
      expect(yield* Effect.flip(createItem({ title: "x", id: "../escape" }))).toBeInstanceOf(
        InvalidRequest,
      );
      expect(yield* Effect.flip(getItem("missing/item"))).toBeInstanceOf(NotFound);
    }),
  );

  it.live("feedback reopens done items and resolves", () =>
    Effect.gen(function* () {
      const item = yield* createItem({ title: "Hook test" });
      yield* updateItem(item.id, { status: "done" });

      const added = yield* addFeedback(item.id, {
        body: "Hook is too slow",
        media: "[9x16] video.mp4",
        timecode: 1.2,
      });

      const open = yield* openFeedback();
      yield* resolveFeedback(item.id, added.feedback.id, "Cut the intro");

      expect(added.item.doc.status).toBe("review");
      expect(open.map((entry) => entry.feedback.timecode)).toEqual([1.2]);
      expect(yield* openFeedback()).toEqual([]);
    }),
  );

  it.live("feedback needs a message and a known entry to resolve", () =>
    Effect.gen(function* () {
      const { id } = yield* createItem({ title: "Quiet" });

      expect(yield* Effect.flip(addFeedback(id, { body: "  " }))).toBeInstanceOf(InvalidRequest);
      expect(yield* Effect.flip(resolveFeedback(id, "nope", "done"))).toBeInstanceOf(NotFound);
    }),
  );

  it.live("a caption from an earlier version moves into the notes and stays there", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const file = "items/posts/intro/item.yaml";

      yield* ws.writeText(
        file,
        "title: Intro\nstatus: review\nnotes: Keep it short\ncaption: Three tips in 30 seconds\n",
      );

      const read = yield* getItem("posts/intro");
      yield* updateItem(read.id, { hook: "Start strong" });
      const written = yield* getItem(read.id);

      expect(read.doc.notes).toBe("Keep it short\n\nCaption: Three tips in 30 seconds");
      expect(written.doc.notes).toBe("Keep it short\n\nCaption: Three tips in 30 seconds");
      expect(yield* ws.readText(file)).not.toContain("caption:");
    }),
  );

  it.live("a status from an earlier version reads as its successor and is written as one", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const file = "items/posts/intro/item.yaml";

      yield* ws.writeText(file, "title: Intro\nstatus: published\n");

      const read = yield* getItem("posts/intro");
      yield* updateItem(read.id, { hook: "Start strong" });

      expect(read.doc.status).toBe("done");
      expect(yield* ws.readText(file)).toContain("status: done");
    }),
  );

  it.live("refuses paths that escape the workspace", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      expect(yield* Effect.flip(ws.abs("../outside"))).toBeInstanceOf(WorkspaceError);
    }),
  );

  it.live("only folders with item.yaml are items; other folders group them", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;

      yield* ws.writeText("items/lessons/repotting/notes.md", "# Repotting\n");
      yield* ws.writeText("items/guides/notes.md", "# Guides\n");
      yield* ws.writeText("items/guides/by-style/item.yaml", "title: By style\n");

      expect(yield* listItemIds()).toEqual(["guides/by-style"]);
      expect(yield* Effect.flip(getItem("lessons/repotting"))).toBeInstanceOf(NotFound);
    }),
  );
});
