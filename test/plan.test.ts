import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Option } from "effect";

import { listItemIds } from "../src/core/items.ts";
import { OFFLINE_GRACE_MS, isPaid, paidInSettings, type LicenseRecord } from "../src/license.ts";
import {
  DesktopData,
  FREE_VIDEOS,
  FreeLimitReached,
  PRICING_URL,
  createCountedItem,
  freeVersionNote,
  planOf,
  planStatus,
  type Plan,
} from "../src/plan.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

const NOW = Date.parse("2026-10-20T00:00:00Z");

const DAY = 24 * 60 * 60 * 1_000;

const plan: LicenseRecord = { checkedAt: NOW - DAY, expiresAt: null };

/** What settings.json may hold as cutfac.com's last answer: one, one from an older app, or junk. */
type SavedLicense =
  | LicenseRecord
  | (LicenseRecord & { readonly trial: boolean })
  | { readonly checkedAt: string };

/** The desktop app's settings.json, with `license` saved for the key. */
const settings = (license?: SavedLicense, licenseKey = "KEY-1") =>
  JSON.stringify({ locale: "en", licenseKey, license });

const free = (used: number): Plan => ({
  edition: "desktop",
  paid: false,
  used,
  limit: FREE_VIDEOS,
});

describe("paid plan", () => {
  test("a grant unlocks the paid plan until it runs out", () => {
    const ending: LicenseRecord = { checkedAt: NOW - DAY, expiresAt: NOW + 3 * DAY };

    expect(isPaid(plan, NOW)).toBe(true);
    expect(isPaid(ending, NOW + 3 * DAY - 1)).toBe(true);
    expect(isPaid(ending, NOW + 3 * DAY)).toBe(false);
  });

  test("offline, a grant holds for the grace and then falls back to free", () => {
    const heard: LicenseRecord = { checkedAt: NOW, expiresAt: null };

    expect(isPaid(heard, NOW + OFFLINE_GRACE_MS)).toBe(true);
    expect(isPaid(heard, NOW + OFFLINE_GRACE_MS + 1)).toBe(false);
  });

  test("a refusal, or no answer yet, is the free version", () => {
    expect(isPaid({ checkedAt: NOW, refusal: "invalid" }, NOW)).toBe(false);
    expect(isPaid({ checkedAt: NOW, refusal: "ended" }, NOW)).toBe(false);
    expect(isPaid(undefined, NOW)).toBe(false);
  });

  test("the app's settings unlock it only with a key and a grant", () => {
    expect(paidInSettings(settings(plan), NOW)).toBe(true);
    expect(paidInSettings(settings(plan, ""), NOW)).toBe(false);
    expect(paidInSettings(JSON.stringify({ license: plan }), NOW)).toBe(false);
    expect(paidInSettings(settings({ checkedAt: "yesterday" }), NOW)).toBe(false);
    expect(paidInSettings(settings(undefined), NOW)).toBe(false);
    expect(paidInSettings("not json", NOW)).toBe(false);
    expect(paidInSettings("null", NOW)).toBe(false);
  });

  test("a grant saved by an app that still told trials apart unlocks it too", () => {
    expect(paidInSettings(settings({ ...plan, trial: true }), NOW)).toBe(true);
  });
});

describe("plan", () => {
  test("a paid plan has no count", () => {
    expect(planOf(settings(plan), "a\nb\nc\nd\n", NOW)).toEqual({ edition: "desktop", paid: true });
  });

  test("the free version counts the videos made, up to its limit", () => {
    expect(planOf(undefined, "", NOW)).toEqual(free(0));
    expect(planOf(settings({ checkedAt: NOW, refusal: "ended" }), "a\n\n  \nb\n", NOW)).toEqual(
      free(2),
    );
    expect(planOf(undefined, "a\nb\nc\nd\ne\n", NOW)).toEqual(free(FREE_VIDEOS));
  });

  test("agents hear about the free version, and about upgrading once it is used up", () => {
    const usedUp = freeVersionNote(free(3));

    expect(freeVersionNote({ edition: "open-source" })).toBeUndefined();
    expect(freeVersionNote({ edition: "desktop", paid: true })).toBeUndefined();
    expect(freeVersionNote(free(1))).toBe("Cutfac free version: 1 of 3 videos used on this Mac.");
    expect(usedUp).toContain("3 of 3 videos used");
    expect(usedUp).toContain(PRICING_URL);
    expect(usedUp).toContain("existing ones stay editable");
  });
});

describe("making videos on the desktop app", () => {
  let t: TestWorkspace;
  let data: string;

  beforeEach(async () => {
    t = await makeWorkspace();
    data = await mkdtemp(join(tmpdir(), "cutfac-app-data-"));
  });

  afterEach(async () => {
    await t.remove();
    await rm(data, { recursive: true, force: true });
  });

  const onThisMac = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, DesktopData, Option.some(data));

  const make = (title: string) => onThisMac(createCountedItem({ title }));

  const counted = async () =>
    (await readFile(join(data, "videos.log"), "utf8")).split("\n").filter(Boolean);

  test("the free version makes its videos, then refuses a new one", async () => {
    for (const title of ["One", "Two", "Three"]) await t.run(make(title));

    const error = await t.fail(make("Four"));

    expect(error).toBeInstanceOf(FreeLimitReached);
    expect(error.message).toContain(PRICING_URL);
    expect(await t.run(listItemIds())).toHaveLength(3);
    expect(await counted()).toHaveLength(3);
    expect(await t.run(onThisMac(planStatus()))).toEqual({
      edition: "desktop",
      paid: false,
      used: 3,
      limit: 3,
    });
  });

  test("the count is the Mac's, so a new workspace doesn't start over", async () => {
    for (const title of ["One", "Two", "Three"]) await t.run(make(title));
    const other = await makeWorkspace("other");

    try {
      expect(await other.fail(make("Four"))).toBeInstanceOf(FreeLimitReached);
    } finally {
      await other.remove();
    }
  });

  test("a paid plan makes as many as it likes, and they still count", async () => {
    await writeFile(
      join(data, "settings.json"),
      settings({ checkedAt: Date.now(), expiresAt: null }),
    );

    for (const title of ["One", "Two", "Three", "Four"]) await t.run(make(title));

    expect(await counted()).toHaveLength(4);

    await writeFile(
      join(data, "settings.json"),
      settings({ checkedAt: Date.now(), refusal: "ended" }),
    );

    expect(await t.fail(make("Five"))).toBeInstanceOf(FreeLimitReached);
  });

  test("the open-source CLI has no limit and keeps no count", async () => {
    for (const title of ["One", "Two", "Three", "Four"]) await t.run(createCountedItem({ title }));

    expect(await t.run(listItemIds())).toHaveLength(4);
    expect(await t.run(planStatus())).toEqual({ edition: "open-source" });
  });
});
