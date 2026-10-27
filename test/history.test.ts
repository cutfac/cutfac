import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Clock, Effect, FileSystem, Ref } from "effect";

import { requestEdit, resolveEdit, restoreBefore } from "../src/core/edits.ts";
import { InvalidRequest, NotFound } from "../src/core/errors.ts";
import {
  MAX_ENTRIES,
  goTo,
  pushEntry,
  readHistory,
  redo,
  restoreVersion,
  undo,
  updateDetails,
} from "../src/core/history.ts";
import { createItem, getItem, updateItem } from "../src/core/items.ts";
import type { HistoryDoc, HistoryEntry } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const VIDEO = "[9x16] video.mp4";

const empty: HistoryDoc = { cursor: 0, entries: [], versions: [], heads: {} };

const details = (id: string): HistoryEntry => ({
  kind: "details",
  id,
  at: "2026-01-01T00:00:00Z",
  before: { title: "a" },
  after: { title: "b" },
});

describe("pushEntry", () => {
  test("drops the changes that could have been redone", () => {
    const two = pushEntry(pushEntry(empty, details("1")), details("2"));
    const next = pushEntry({ ...two, cursor: 1 }, details("3"));

    expect(next.entries.map((e) => e.id)).toEqual(["1", "3"]);
    expect(next.cursor).toBe(2);
  });

  test("keeps the latest changes", () => {
    let doc = empty;

    for (let i = 0; i < MAX_ENTRIES + 5; i++) doc = pushEntry(doc, details(String(i)));

    expect(doc.entries).toHaveLength(MAX_ENTRIES);
    expect(doc.cursor).toBe(MAX_ENTRIES);
    expect(doc.entries[0]?.id).toBe("5");
  });
});

const fixture = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const ws = yield* Workspace;
  const { id } = yield* createItem({ title: "Clip" });
  const video = join(ws.root, "items", id, VIDEO);
  const clock = yield* Ref.make((yield* Clock.currentTimeMillis) - 60_000);

  /** Write the video with a later mtime each time, as an agent's edit would have. */
  const write = Effect.fnUntraced(function* (content: string) {
    yield* fs.writeFileString(video, content);
    const at = new Date(yield* Ref.updateAndGet(clock, (millis) => millis + 1000));
    yield* fs.utimes(video, at, at);
  });

  yield* write("original");
  yield* Ref.set(clock, (yield* Clock.currentTimeMillis) + 60_000);

  /** Request an edit on the video, change it, and resolve the request. */
  const edit = Effect.fnUntraced(function* (result: string) {
    const { feedback } = yield* requestEdit(id, { body: "Brighter", media: VIDEO });
    yield* write(result);
    yield* resolveEdit(id, feedback.id, "Brighter");

    return feedback.id;
  });

  return {
    id,
    write,
    edit,
    content: fs.readFileString(video),
    history: Effect.flatMap(getItem(id), readHistory),
    decision: Effect.map(getItem(id), (item) => item.doc.feedback[0]?.decision),
  };
});

describe("item history", () => {
  it.live("undoes and redoes field changes", () =>
    Effect.gen(function* () {
      const { id } = yield* fixture;

      yield* updateDetails(id, { title: "Launch", hook: "Wait for it" });

      const undone = yield* undo(id);

      expect([undone.doc.title, undone.doc.hook]).toEqual(["Clip", undefined]);
      expect(yield* Effect.flip(undo(id))).toBeInstanceOf(InvalidRequest);

      const redone = yield* redo(id);

      expect([redone.doc.title, redone.doc.hook]).toEqual(["Launch", "Wait for it"]);
      expect(yield* Effect.flip(redo(id))).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("leaves a field that changed since alone", () =>
    Effect.gen(function* () {
      const { id } = yield* fixture;

      yield* updateDetails(id, { title: "Launch", hook: "Wait for it" });
      yield* updateItem(id, { title: "Renamed" });

      const undone = yield* undo(id);

      expect([undone.doc.title, undone.doc.hook]).toEqual(["Renamed", undefined]);
    }),
  );

  it.live("records nothing when the fields stay the same", () =>
    Effect.gen(function* () {
      const { id, history } = yield* fixture;

      yield* updateDetails(id, { title: "Clip" });

      expect((yield* history).entries).toEqual([]);
    }),
  );

  it.live("undoes an edit and marks the request rolled back", () =>
    Effect.gen(function* () {
      const { id, edit, history, content, decision } = yield* fixture;
      const feedbackId = yield* edit("edited");
      const doc = yield* history;

      expect(doc.cursor).toBe(1);
      expect(doc.entries[0]).toMatchObject({ kind: "media", cause: "edit", feedbackId });
      expect(doc.versions.map((v) => v.file)).toEqual([
        `edits/${feedbackId}/before.mp4`,
        `edits/${feedbackId}/after.mp4`,
      ]);

      yield* undo(id);

      expect(yield* content).toBe("original");
      expect(yield* decision).toBe("restored");

      yield* redo(id);

      expect(yield* content).toBe("edited");
      expect(yield* decision).toBe("approved");
    }),
  );

  it.live("saves a change made outside a request before undoing", () =>
    Effect.gen(function* () {
      const { id, edit, write, history, content } = yield* fixture;

      yield* edit("edited");
      yield* write("changed by hand");
      yield* undo(id);

      expect(yield* content).toBe("edited");

      const doc = yield* history;

      expect(doc.entries.map((e) => (e.kind === "media" ? e.cause : e.kind))).toEqual([
        "edit",
        "outside",
      ]);
      expect(doc.cursor).toBe(1);

      yield* redo(id);

      expect(yield* content).toBe("changed by hand");
    }),
  );

  it.live("restores a saved version and jumps through the history", () =>
    Effect.gen(function* () {
      const { id, edit, history, content } = yield* fixture;

      yield* edit("edited");
      const [first] = (yield* history).versions;

      yield* restoreVersion(id, first?.id ?? "");

      expect(yield* content).toBe("original");
      expect((yield* history).entries.map((e) => (e.kind === "media" ? e.cause : ""))).toEqual([
        "edit",
        "version",
      ]);

      yield* goTo(id);

      expect(yield* content).toBe("original");
      expect((yield* history).cursor).toBe(0);

      const entries = (yield* history).entries;
      yield* goTo(id, entries[0]?.id);

      expect(yield* content).toBe("edited");
      expect((yield* history).cursor).toBe(1);
      expect(yield* Effect.flip(goTo(id, "missing"))).toBeInstanceOf(NotFound);
      expect(yield* Effect.flip(restoreVersion(id, "missing"))).toBeInstanceOf(NotFound);
    }),
  );

  it.live("a new change drops the undone ones", () =>
    Effect.gen(function* () {
      const { id, edit, history } = yield* fixture;

      yield* edit("edited");
      yield* undo(id);
      yield* updateDetails(id, { title: "Launch" });

      const doc = yield* history;

      expect(doc.entries.map((e) => e.kind)).toEqual(["details"]);
      expect(doc.cursor).toBe(1);
      expect(yield* Effect.flip(redo(id))).toBeInstanceOf(InvalidRequest);
    }),
  );

  it.live("undoes a rollback", () =>
    Effect.gen(function* () {
      const { id, edit, history, content, decision } = yield* fixture;
      const feedbackId = yield* edit("edited");

      yield* restoreBefore(id, feedbackId);

      expect(yield* content).toBe("original");
      expect((yield* history).entries.map((e) => (e.kind === "media" ? e.cause : ""))).toEqual([
        "edit",
        "restore",
      ]);

      yield* undo(id);

      expect(yield* content).toBe("edited");
      expect(yield* decision).toBe("approved");

      yield* undo(id);

      expect(yield* content).toBe("original");
      expect(yield* decision).toBe("restored");
    }),
  );

  it.live("tracks a request about the whole item without deciding it", () =>
    Effect.gen(function* () {
      const { id, write, content, decision } = yield* fixture;
      const { feedback } = yield* requestEdit(id, { body: "Tighter cut" });

      yield* write("recut");
      yield* resolveEdit(id, feedback.id, "Recut");
      yield* undo(id);

      expect(yield* content).toBe("original");
      expect(yield* decision).toBeUndefined();
    }),
  );
});
