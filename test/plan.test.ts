import { describe, expect } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

// A workspace made for one check is provided where that check runs.
// @effect-diagnostics strictEffectProvide:off
import { Clock, Duration, Effect, FileSystem, Layer, Option, Path } from "effect";
import { TestClock } from "effect/testing";

import { listItemIds } from "../src/core/items.ts";
import {
  LICENSE_PUBLIC_KEY,
  LicenseKey,
  LicensePublicKey,
  LicenseRecord,
  OFFLINE_GRACE,
  isPaid,
  paidInSettings,
} from "../src/license.ts";
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
import { testEffect } from "./effect.ts";
import { signedGrant, tempWorkspace, testLicenseKey } from "./support.ts";

const it = testEffect(testLicenseKey);

const NOW = Date.parse("2026-10-20T00:00:00Z");

const DAY = 24 * 60 * 60 * 1_000;

const GRACE = Duration.toMillis(OFFLINE_GRACE);

const KEY_1 = Option.some(LicenseKey.make("KEY-1"));

/** A grant from cutfac.com, saved as `token`. */
const granted = (token: string) => Option.some(LicenseRecord.cases.LicenseGrant.make({ token }));

/** cutfac.com's grant for KEY-1, heard at `checkedAt`. */
const signed = (checkedAt: number, expiresAt: number | null = null) =>
  granted(signedGrant(checkedAt, expiresAt));

const plan = signed(NOW - DAY);

/** Whether `record`, saved for KEY-1, unlocks the paid plan at `now`. */
const paidAt = Effect.fnUntraced(function* (record: Option.Option<LicenseRecord>, now: number) {
  yield* TestClock.setTime(now);

  return yield* isPaid({ key: KEY_1, record });
});

/** Whether settings.json's `text` unlocks the paid plan at NOW. */
const paidIn = (text: string) => Effect.andThen(TestClock.setTime(NOW), paidInSettings(text));

/** What settings.json may hold as cutfac.com's last answer: one, one from an older app, or junk. */
type SavedRecord =
  | typeof LicenseRecord.Encoded
  | { readonly checkedAt: number; readonly expiresAt: number | null }
  | { readonly checkedAt: string };

/** The desktop app's settings.json, with `license` saved for the key. */
const settings = (license?: SavedRecord, licenseKey = "KEY-1") =>
  JSON.stringify({ locale: "en", licenseKey, license });

/** cutfac.com's grant for KEY-1 as settings.json holds it, a day old. */
const savedPlan = { token: signedGrant(NOW - DAY) };

const free = (used: number): Plan => ({
  edition: "desktop",
  paid: false,
  used,
  limit: FREE_VIDEOS,
});

describe("paid plan", () => {
  it.effect("a grant unlocks the paid plan until it runs out", () =>
    Effect.gen(function* () {
      const ending = signed(NOW - DAY, NOW + 3 * DAY);

      expect(yield* paidAt(plan, NOW)).toBe(true);
      expect(yield* paidAt(ending, NOW + 3 * DAY - 1)).toBe(true);
      expect(yield* paidAt(ending, NOW + 3 * DAY)).toBe(false);
    }),
  );

  it.effect("offline, a grant holds for the grace and then falls back to free", () =>
    Effect.gen(function* () {
      const heard = signed(NOW);

      expect(yield* paidAt(heard, NOW + GRACE)).toBe(true);
      expect(yield* paidAt(heard, NOW + GRACE + 1)).toBe(false);
    }),
  );

  it.effect("a grant timed a day ahead of this Mac's clock holds, but not one further ahead", () =>
    Effect.gen(function* () {
      expect(yield* paidAt(signed(NOW + DAY), NOW)).toBe(true);
      expect(yield* paidAt(signed(NOW + DAY + 1), NOW)).toBe(false);
      expect(yield* paidAt(signed(Date.parse("2100-01-01")), NOW)).toBe(false);
    }),
  );

  it.effect("only a grant cutfac.com signed for the saved key unlocks it", () =>
    Effect.gen(function* () {
      const [payload] = signedGrant(NOW).split(".");
      const [, signature] = signedGrant(NOW - DAY).split(".");
      const otherSigner = generateKeyPairSync("ed25519");
      const key2 = Option.some(LicenseKey.make("KEY-2"));

      // The app's own key, which no test holds the private half of.
      const appKey = paidAt(plan, NOW).pipe(
        Effect.provideService(LicensePublicKey, LICENSE_PUBLIC_KEY),
      );

      expect(yield* isPaid({ key: key2, record: plan })).toBe(false);
      expect(yield* paidAt(granted(`${payload}.${signature}`), NOW)).toBe(false);
      expect(yield* paidAt(granted(signedGrant(NOW, null, "KEY-1", otherSigner)), NOW)).toBe(false);
      expect(yield* paidAt(granted("not a token"), NOW)).toBe(false);
      expect(yield* appKey).toBe(false);
    }),
  );

  it.effect("a refusal, or no answer or key yet, is the free version", () =>
    Effect.gen(function* () {
      const refused = (refusal: "invalid" | "ended") =>
        Option.some(LicenseRecord.cases.LicenseRefusal.make({ checkedAt: NOW, refusal }));

      expect(yield* paidAt(refused("invalid"), NOW)).toBe(false);
      expect(yield* paidAt(refused("ended"), NOW)).toBe(false);
      expect(yield* paidAt(Option.none(), NOW)).toBe(false);
      expect(yield* isPaid({ key: Option.none(), record: plan })).toBe(false);
    }),
  );

  it.effect("the app's settings unlock it only with a key and its grant", () =>
    Effect.gen(function* () {
      expect(yield* paidIn(settings(savedPlan))).toBe(true);
      expect(yield* paidIn(settings(savedPlan, ""))).toBe(false);
      expect(yield* paidIn(settings(savedPlan, "KEY-2"))).toBe(false);
      expect(yield* paidIn(JSON.stringify({ license: savedPlan }))).toBe(false);
      expect(yield* paidIn(settings({ checkedAt: "yesterday" }))).toBe(false);
      expect(yield* paidIn(settings(undefined))).toBe(false);
      expect(yield* paidIn("not json")).toBe(false);
      expect(yield* paidIn("null")).toBe(false);
    }),
  );

  it.effect(
    "a grant saved before grants were signed, or written by hand, is the free version",
    () =>
      Effect.gen(function* () {
        expect(yield* paidIn(settings({ checkedAt: NOW - DAY, expiresAt: null }))).toBe(false);
      }),
  );
});

describe("plan", () => {
  it.effect("a paid plan has no count", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      expect(yield* planOf(Option.some(settings(savedPlan)), "a\nb\nc\nd\n")).toEqual({
        edition: "desktop",
        paid: true,
      });
    }),
  );

  it.effect("the free version counts the videos made, up to its limit", () =>
    Effect.gen(function* () {
      const ended = Option.some(settings({ checkedAt: NOW, refusal: "ended" }));

      yield* TestClock.setTime(NOW);

      expect(yield* planOf(Option.none(), "")).toEqual(free(0));
      expect(yield* planOf(ended, "a\n\n  \nb\n")).toEqual(free(2));
      expect(yield* planOf(Option.none(), "a\nb\nc\nd\ne\n")).toEqual(free(FREE_VIDEOS));
    }),
  );

  it.effect("agents hear about the free version, and about upgrading once it is used up", () =>
    Effect.sync(() => {
      const usedUp = Option.getOrThrow(freeVersionNote(free(3)));

      expect(freeVersionNote({ edition: "open-source" })).toEqual(Option.none());
      expect(freeVersionNote({ edition: "desktop", paid: true })).toEqual(Option.none());
      expect(freeVersionNote(free(1))).toEqual(
        Option.some("Cutfac free version: 1 of 3 videos used on this Mac."),
      );
      expect(usedUp).toContain("3 of 3 videos used");
      expect(usedUp).toContain(PRICING_URL);
      expect(usedUp).toContain("existing ones stay editable");
    }),
  );
});

/** The desktop app's data folder on this Mac, in a temporary folder removed after the test. */
const appDataFolder = Layer.effect(
  DesktopData,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return Option.some(yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-data-" }));
  }),
);

/** The desktop app, with a workspace and its data folder; its files wait on the real clock. */
const onThisMac = testEffect(
  appDataFolder.pipe(Layer.provideMerge(Layer.mergeAll(tempWorkspace(), testLicenseKey))),
);

/** The open-source CLI in a workspace, with no data folder. */
const fromSource = testEffect(tempWorkspace());

/** The file `name` in the desktop app's data folder. */
const dataFile = Effect.fnUntraced(function* (name: string) {
  const path = yield* Path.Path;

  return path.join(yield* Effect.fromOption(yield* DesktopData), name);
});

/** The videos counted on this Mac, a line each. */
const counted = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const log = yield* fs.readFileString(yield* dataFile("videos.log"));

  return log.split("\n").filter(Boolean);
});

/** Saves the desktop app's settings.json with `license` for KEY-1. */
const saveLicense = Effect.fnUntraced(function* (license: SavedRecord) {
  const fs = yield* FileSystem.FileSystem;

  yield* fs.writeFileString(yield* dataFile("settings.json"), settings(license));
});

const make = (title: string) => createCountedItem({ title });

describe("making videos on the desktop app", () => {
  onThisMac.live("the free version makes its videos, then refuses a new one", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["One", "Two", "Three"], make);

      const error = yield* Effect.flip(make("Four"));

      expect(error).toBeInstanceOf(FreeLimitReached);
      expect(error.message).toContain(PRICING_URL);
      expect(yield* listItemIds()).toHaveLength(3);
      expect(yield* counted).toHaveLength(3);
      expect(yield* planStatus()).toEqual({ edition: "desktop", paid: false, used: 3, limit: 3 });
    }),
  );

  onThisMac.live("the count is the Mac's, so a new workspace doesn't start over", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["One", "Two", "Three"], make);

      const inOther = make("Four").pipe(Effect.provide(tempWorkspace("other")));

      expect(yield* Effect.flip(inOther)).toBeInstanceOf(FreeLimitReached);
    }),
  );

  onThisMac.live("a paid plan makes as many as it likes, and they still count", () =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;

      yield* saveLicense({ token: signedGrant(now) });
      yield* Effect.forEach(["One", "Two", "Three", "Four"], make);

      expect(yield* counted).toHaveLength(4);

      yield* saveLicense({ checkedAt: now, refusal: "ended" });

      expect(yield* Effect.flip(make("Five"))).toBeInstanceOf(FreeLimitReached);
    }),
  );

  fromSource.live("the open-source CLI has no limit and keeps no count", () =>
    Effect.gen(function* () {
      yield* Effect.forEach(["One", "Two", "Three", "Four"], make);

      expect(yield* listItemIds()).toHaveLength(4);
      expect(yield* planStatus()).toEqual({ edition: "open-source" });
    }),
  );
});
