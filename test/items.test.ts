import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  let root: string;
  let ws: Workspace;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "factory-"));
    await writeFile(join(root, "factory.yaml"), "name: test\n");
    ws = await Workspace.open(root);
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  test("creates, updates, and dedupes ids", async () => {
    const a = await createItem(ws, { title: "Fried Liver Trap", format: "trap" });
    const b = await createItem(ws, { title: "Fried Liver Trap", format: "trap" });
    expect([a.id, b.id]).toEqual(["trap/fried-liver-trap", "trap/fried-liver-trap-2"]);
    const updated = await updateItem(ws, a.id, {
      status: "review",
      platforms: { tiktok: { caption: "one" } },
    });
    expect(updated.doc.status).toBe("review");
    const merged = await updateItem(ws, a.id, { platforms: { tiktok: { hashtags: ["#chess"] } } });
    expect(merged.doc.platforms.tiktok).toEqual({ caption: "one", hashtags: ["#chess"] });
  });

  test("feedback reopens approved items and resolves", async () => {
    const item = await createItem(ws, { title: "Hook test" });
    await updateItem(ws, item.id, { status: "approved" });
    const withFeedback = await addFeedback(ws, item.id, {
      body: "Hook is too slow",
      media: "[9x16] video.mp4",
      timecode: 1.2,
    });
    expect(withFeedback.doc.status).toBe("review");
    const [open] = await openFeedback(ws);
    expect(open?.feedback.timecode).toBe(1.2);
    await resolveFeedback(ws, item.id, open!.feedback.id, "Cut the intro");
    expect(await openFeedback(ws)).toEqual([]);
  });

  test("schedule entries drive status", async () => {
    const item = await createItem(ws, { title: "Post" });
    await upsertSchedule(ws, item.id, {
      platform: "tiktok",
      at: "2026-10-12T19:00:00+09:00",
      status: "scheduled",
    });
    expect((await getItem(ws, item.id)).doc.status).toBe("scheduled");
    const done = await upsertSchedule(ws, item.id, {
      platform: "tiktok",
      at: "2026-10-12T19:00:00+09:00",
      status: "published",
    });
    expect(done.doc.status).toBe("published");
    expect(done.doc.schedule).toHaveLength(1);
  });

  test("discovers legacy folders and upgrades them on write", async () => {
    const dir = join(root, "items/lessons/caro-kann");
    await mkdir(join(dir, "frames"), { recursive: true });
    await writeFile(join(dir, "POSTING.md"), "# Caro-Kann Posting\n");
    await writeFile(join(dir, "STATUS.md"), "- status: ready-to-post\n");
    await writeFile(join(dir, "[1x1] 01-hook.jpg"), "");
    expect(await listItemIds(ws)).toEqual(["lessons/caro-kann"]);
    const legacy = await getItem(ws, "lessons/caro-kann");
    expect([legacy.legacy, legacy.doc.title, legacy.doc.status]).toEqual([
      true,
      "Caro-Kann",
      "approved",
    ]);
    const upgraded = await addFeedback(ws, legacy.id, { body: "Bigger board" });
    expect(upgraded.legacy).toBe(false);
    expect(upgraded.doc.title).toBe("Caro-Kann");
  });

  test("refuses paths that escape the workspace", () => {
    expect(() => ws.abs("../outside")).toThrow();
  });
});

describe("legacy series folders", () => {
  test("a marked folder with child items is a group", async () => {
    const root = await mkdtemp(join(tmpdir(), "factory-"));
    try {
      await writeFile(join(root, "factory.yaml"), "name: test\n");
      const ws = await Workspace.open(root);
      await mkdir(join(root, "items/guides/indexes/by-style"), { recursive: true });
      await writeFile(join(root, "items/guides/indexes/STATUS.md"), "# Indexes status\n");
      await writeFile(
        join(root, "items/guides/indexes/by-style/STATUS.md"),
        "# By style — status\n- status: published\n",
      );
      expect(await listItemIds(ws)).toEqual(["guides/indexes/by-style"]);
      expect((await getItem(ws, "guides/indexes/by-style")).doc.title).toBe("By style");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
