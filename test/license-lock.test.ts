import { describe, expect, test } from "bun:test";

import {
  OFFLINE_GRACE_MS,
  licenseLock,
  lockChangesAt,
  lockInSettings,
  type LicenseRecord,
} from "../src/license.ts";

const NOW = Date.parse("2026-10-19T00:00:00Z");

const DAY = 24 * 60 * 60 * 1_000;

const plan: LicenseRecord = { checkedAt: NOW - DAY, expiresAt: null, trial: false };

const trial: LicenseRecord = { checkedAt: NOW - DAY, expiresAt: NOW + 3 * DAY, trial: true };

describe("license lock", () => {
  test("a fresh grant keeps the app open", () => {
    expect(licenseLock(true, plan, NOW)).toBeUndefined();
    expect(licenseLock(true, trial, NOW)).toBeUndefined();
  });

  test("no key, or a key cutfac.com has yet to answer for, locks the app", () => {
    expect(licenseLock(false, plan, NOW)).toBe("missing");
    expect(licenseLock(true, undefined, NOW)).toBe("offline");
  });

  test("a refusal locks the app for the reason cutfac.com gave", () => {
    expect(licenseLock(true, { checkedAt: NOW, refusal: "invalid" }, NOW)).toBe("invalid");
    expect(licenseLock(true, { checkedAt: NOW, refusal: "ended" }, NOW)).toBe("ended");
  });

  test("a trial ends at its expiry even without a new check", () => {
    expect(licenseLock(true, trial, NOW + 3 * DAY - 1)).toBeUndefined();
    expect(licenseLock(true, trial, NOW + 3 * DAY)).toBe("ended");
  });

  test("the app stays open offline for the grace, then locks", () => {
    expect(licenseLock(true, plan, plan.checkedAt + OFFLINE_GRACE_MS)).toBeUndefined();
    expect(licenseLock(true, plan, plan.checkedAt + OFFLINE_GRACE_MS + 1)).toBe("offline");
  });

  test("the lock next changes at the trial's end or the grace's, whichever is first", () => {
    expect(lockChangesAt(plan)).toBe(plan.checkedAt + OFFLINE_GRACE_MS);
    expect(lockChangesAt(trial)).toBe(NOW + 3 * DAY);
    expect(lockChangesAt({ ...trial, expiresAt: NOW + 30 * DAY })).toBe(
      trial.checkedAt + OFFLINE_GRACE_MS,
    );
    expect(lockChangesAt({ checkedAt: NOW, refusal: "ended" })).toBeUndefined();
    expect(lockChangesAt(undefined)).toBeUndefined();
  });
});

describe("license lock in the desktop app's settings", () => {
  test("a saved key and grant leave the agent tools open", () => {
    expect(
      lockInSettings(JSON.stringify({ licenseKey: "KEY-1", license: plan }), NOW),
    ).toBeUndefined();
  });

  test("a missing key, a refusal, or a damaged record locks them", () => {
    expect(lockInSettings(JSON.stringify({ workspace: "/ws" }), NOW)).toBe("missing");
    expect(lockInSettings(JSON.stringify({ licenseKey: "", license: plan }), NOW)).toBe("missing");
    expect(
      lockInSettings(
        JSON.stringify({ licenseKey: "KEY-1", license: { checkedAt: NOW, refusal: "ended" } }),
        NOW,
      ),
    ).toBe("ended");
    expect(
      lockInSettings(JSON.stringify({ licenseKey: "KEY-1", license: { trial: "yes" } }), NOW),
    ).toBe("offline");
  });

  test("text that isn't a settings file never locks them", () => {
    expect(lockInSettings("{not json", NOW)).toBeUndefined();
    expect(lockInSettings("[]", NOW)).toBeUndefined();
  });
});
