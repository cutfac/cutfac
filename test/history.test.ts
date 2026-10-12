import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

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
import { makeWorkspace, type TestWorkspace } from "./support.ts";

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

describe("item history", () => {
  let t: TestWorkspace;
  let id: string;
  let video: string;
  let clock: number;

  /** Write the video with a later mtime each time, as an agent's edit would have. */
  const write = async (content: string) => {
    await writeFile(video, content);
    clock += 1000;
    const at = new Date(clock);
    await utimes(video, at, at);
  };

  const content = () => readFile(video, "utf8");

  const history = () => t.run(Effect.flatMap(getItem(id), readHistory));

  const decision = async () => (await t.run(getItem(id))).doc.feedback[0]?.decision;

  /** Request an edit on the video, change it, and resolve the request. */
  const edit = async (result: string) => {
    const { feedback } = await t.run(requestEdit(id, { body: "Brighter", media: VIDEO }));
    await write(result);
    await t.run(resolveEdit(id, feedback.id, "Brighter"));

    return feedback.id;
  };

  beforeEach(async () => {
    t = await makeWorkspace();
    id = await t.run(Effect.map(createItem({ title: "Clip" }), (item) => item.id));
    video = join(t.root, "items", id, VIDEO);
    clock = Date.now() - 60_000;
    await write("original");
    clock = Date.now() + 60_000;
  });

  afterEach(() => t.remove());

  test("undoes and redoes field changes", async () => {
    await t.run(updateDetails(id, { title: "Launch", hook: "Wait for it" }));

    const undone = await t.run(undo(id));

    expect([undone.doc.title, undone.doc.hook]).toEqual(["Clip", undefined]);
    expect(await t.fail(undo(id))).toBeInstanceOf(InvalidRequest);

    const redone = await t.run(redo(id));

    expect([redone.doc.title, redone.doc.hook]).toEqual(["Launch", "Wait for it"]);
    expect(await t.fail(redo(id))).toBeInstanceOf(InvalidRequest);
  });

  test("leaves a field that changed since alone", async () => {
    await t.run(updateDetails(id, { title: "Launch", hook: "Wait for it" }));
    await t.run(updateItem(id, { title: "Renamed" }));

    const undone = await t.run(undo(id));

    expect([undone.doc.title, undone.doc.hook]).toEqual(["Renamed", undefined]);
  });

  test("records nothing when the fields stay the same", async () => {
    await t.run(updateDetails(id, { title: "Clip" }));

    expect((await history()).entries).toEqual([]);
  });

  test("undoes an edit and marks the request rolled back", async () => {
    const feedbackId = await edit("edited");
    const doc = await history();

    expect(doc.cursor).toBe(1);
    expect(doc.entries[0]).toMatchObject({ kind: "media", cause: "edit", feedbackId });
    expect(doc.versions.map((v) => v.file)).toEqual([
      `edits/${feedbackId}/before.mp4`,
      `edits/${feedbackId}/after.mp4`,
    ]);

    await t.run(undo(id));

    expect(await content()).toBe("original");
    expect(await decision()).toBe("restored");

    await t.run(redo(id));

    expect(await content()).toBe("edited");
    expect(await decision()).toBe("approved");
  });

  test("saves a change made outside a request before undoing", async () => {
    await edit("edited");
    await write("changed by hand");
    await t.run(undo(id));

    expect(await content()).toBe("edited");

    const doc = await history();

    expect(doc.entries.map((e) => (e.kind === "media" ? e.cause : e.kind))).toEqual([
      "edit",
      "outside",
    ]);
    expect(doc.cursor).toBe(1);

    await t.run(redo(id));

    expect(await content()).toBe("changed by hand");
  });

  test("restores a saved version and jumps through the history", async () => {
    await edit("edited");
    const [first] = (await history()).versions;

    await t.run(restoreVersion(id, first?.id ?? ""));

    expect(await content()).toBe("original");
    expect((await history()).entries.map((e) => (e.kind === "media" ? e.cause : ""))).toEqual([
      "edit",
      "version",
    ]);

    await t.run(goTo(id));

    expect(await content()).toBe("original");
    expect((await history()).cursor).toBe(0);

    const entries = (await history()).entries;
    await t.run(goTo(id, entries[0]?.id));

    expect(await content()).toBe("edited");
    expect((await history()).cursor).toBe(1);
    expect(await t.fail(goTo(id, "missing"))).toBeInstanceOf(NotFound);
    expect(await t.fail(restoreVersion(id, "missing"))).toBeInstanceOf(NotFound);
  });

  test("a new change drops the undone ones", async () => {
    await edit("edited");
    await t.run(undo(id));
    await t.run(updateDetails(id, { title: "Launch" }));

    const doc = await history();

    expect(doc.entries.map((e) => e.kind)).toEqual(["details"]);
    expect(doc.cursor).toBe(1);
    expect(await t.fail(redo(id))).toBeInstanceOf(InvalidRequest);
  });

  test("undoes a rollback", async () => {
    const feedbackId = await edit("edited");
    await t.run(restoreBefore(id, feedbackId));

    expect(await content()).toBe("original");
    expect((await history()).entries.map((e) => (e.kind === "media" ? e.cause : ""))).toEqual([
      "edit",
      "restore",
    ]);

    await t.run(undo(id));

    expect(await content()).toBe("edited");
    expect(await decision()).toBe("approved");

    await t.run(undo(id));

    expect(await content()).toBe("original");
    expect(await decision()).toBe("restored");
  });

  test("tracks a request about the whole item without deciding it", async () => {
    const { feedback } = await t.run(requestEdit(id, { body: "Tighter cut" }));
    await write("recut");
    await t.run(resolveEdit(id, feedback.id, "Recut"));
    await t.run(undo(id));

    expect(await content()).toBe("original");
    expect(await decision()).toBeUndefined();
  });
});
