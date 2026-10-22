import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Option } from "effect";

import { listItemIds } from "../src/core/items.ts";
import {
  OFFLINE_GRACE_MS,
  UNSIGNED_GRANTS_UNTIL,
  isPaid,
  paidInSettings,
  type LicenseRecord,
} from "../src/license.ts";
import {
  DesktopData,
  FREE_VIDEOS,
  FreeLimitReached,
  LicensePublicKey,
  PRICING_URL,
  createCountedItem,
  freeVersionNote,
  planOf,
  planStatus,
  type Plan,
} from "../src/plan.ts";
import { licenseSigning, makeWorkspace, signedGrant, type TestWorkspace } from "./support.ts";

const NOW = Date.parse("2026-10-20T00:00:00Z");

const DAY = 24 * 60 * 60 * 1_000;

const { publicKey } = licenseSigning;

/** cutfac.com's grant for KEY-1, heard at `checkedAt`. */
const signed = (checkedAt: number, expiresAt: number | null = null): LicenseRecord => ({
  token: signedGrant(checkedAt, expiresAt),
});

const plan = signed(NOW - DAY);

/** A grant an app from before grants were signed saved, heard at `checkedAt`. */
const unsigned = (checkedAt: number, expiresAt: number | null = null): LicenseRecord => ({
  checkedAt,
  expiresAt,
});

/** Whether `record`, saved for KEY-1, unlocks the paid plan at `now`. */
const paidAt = (record: LicenseRecord | undefined, now: number) =>
  isPaid({ key: "KEY-1", record }, now, publicKey);

/** Whether settings.json's `text` unlocks the paid plan now. */
const paidIn = (text: string) => paidInSettings(text, NOW, publicKey);

/** What settings.json may hold as cutfac.com's last answer: one, or junk. */
type SavedRecord = LicenseRecord | { readonly checkedAt: string };

/** The desktop app's settings.json, with `license` saved for the key. */
const settings = (license?: SavedRecord, licenseKey = "KEY-1") =>
  JSON.stringify({ locale: "en", licenseKey, license });

const free = (used: number): Plan => ({
  edition: "desktop",
  paid: false,
  used,
  limit: FREE_VIDEOS,
});

describe("paid plan", () => {
  test("a grant unlocks the paid plan until it runs out", () => {
    const ending = signed(NOW - DAY, NOW + 3 * DAY);

    expect(paidAt(plan, NOW)).toBe(true);
    expect(paidAt(ending, NOW + 3 * DAY - 1)).toBe(true);
    expect(paidAt(ending, NOW + 3 * DAY)).toBe(false);
  });

  test("offline, a grant holds for the grace and then falls back to free", () => {
    const heard = signed(NOW);

    expect(paidAt(heard, NOW + OFFLINE_GRACE_MS)).toBe(true);
    expect(paidAt(heard, NOW + OFFLINE_GRACE_MS + 1)).toBe(false);
  });

  test("a grant timed a day ahead of this Mac's clock holds, but not one further ahead", () => {
    expect(paidAt(signed(NOW + DAY), NOW)).toBe(true);
    expect(paidAt(signed(NOW + DAY + 1), NOW)).toBe(false);
    expect(paidAt(signed(Date.parse("2100-01-01")), NOW)).toBe(false);
  });

  test("only a grant cutfac.com signed for the saved key unlocks it", () => {
    const [payload] = signedGrant(NOW).split(".");
    const [, signature] = signedGrant(NOW - DAY).split(".");
    const otherSigner = generateKeyPairSync("ed25519");

    expect(isPaid({ key: "KEY-2", record: plan }, NOW, publicKey)).toBe(false);
    expect(paidAt({ token: `${payload}.${signature}` }, NOW)).toBe(false);
    expect(paidAt({ token: signedGrant(NOW, null, "KEY-1", otherSigner) }, NOW)).toBe(false);
    expect(paidAt({ token: "not a token" }, NOW)).toBe(false);
    // The app's own key, which no test holds the private half of.
    expect(isPaid({ key: "KEY-1", record: plan }, NOW)).toBe(false);
  });

  test("a refusal, or no answer or key yet, is the free version", () => {
    expect(paidAt({ checkedAt: NOW, refusal: "invalid" }, NOW)).toBe(false);
    expect(paidAt({ checkedAt: NOW, refusal: "ended" }, NOW)).toBe(false);
    expect(paidAt(undefined, NOW)).toBe(false);
    expect(isPaid({ key: undefined, record: plan }, NOW, publicKey)).toBe(false);
  });

  test("the app's settings unlock it only with a key and its grant", () => {
    expect(paidIn(settings(plan))).toBe(true);
    expect(paidIn(settings(plan, ""))).toBe(false);
    expect(paidIn(settings(plan, "KEY-2"))).toBe(false);
    expect(paidIn(JSON.stringify({ license: plan }))).toBe(false);
    expect(paidIn(settings({ checkedAt: "yesterday" }))).toBe(false);
    expect(paidIn(settings(undefined))).toBe(false);
    expect(paidIn("not json")).toBe(false);
    expect(paidIn("null")).toBe(false);
  });

  test("a grant saved before grants were signed counts as it did, until unsigned ones stop", () => {
    const lastDay = UNSIGNED_GRANTS_UNTIL - DAY;

    expect(paidIn(settings(unsigned(NOW - DAY)))).toBe(true);
    expect(paidIn(settings(unsigned(NOW - DAY), "KEY-2"))).toBe(true);
    expect(paidIn(settings(unsigned(NOW - DAY), ""))).toBe(false);
    expect(paidAt(unsigned(NOW - DAY, NOW), NOW)).toBe(false);
    expect(paidAt(unsigned(NOW - OFFLINE_GRACE_MS - 1), NOW)).toBe(false);
    expect(paidAt(unsigned(lastDay), UNSIGNED_GRANTS_UNTIL - 1)).toBe(true);
    expect(paidAt(unsigned(lastDay), UNSIGNED_GRANTS_UNTIL)).toBe(false);
  });
});

describe("plan", () => {
  test("a paid plan has no count", () => {
    expect(planOf(settings(plan), "a\nb\nc\nd\n", NOW, publicKey)).toEqual({
      edition: "desktop",
      paid: true,
    });
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
    effect.pipe(
      Effect.provideService(DesktopData, Option.some(data)),
      Effect.provideService(LicensePublicKey, publicKey),
    );

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
    await writeFile(join(data, "settings.json"), settings(signed(Date.now())));

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
