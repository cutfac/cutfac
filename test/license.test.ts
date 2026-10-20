import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";

import {
  LICENSE_URL,
  fetchLicense,
  licenseKeyFrom,
  startLicense,
  type License,
} from "../electron/license.ts";
import type { LicenseRecord } from "../src/license.ts";

const NOW = Date.parse("2026-10-20T00:00:00Z");

const HOUR = 60 * 60 * 1_000;

describe("desktop license keys", () => {
  test("keys lose surrounding space; empty and oversized ones are refused", () => {
    expect(licenseKeyFrom("  KEY-1 \n")).toBe("KEY-1");
    expect(licenseKeyFrom("   ")).toBeUndefined();
    expect(licenseKeyFrom("K".repeat(128))).toHaveLength(128);
    expect(licenseKeyFrom("K".repeat(129))).toBeUndefined();
  });

  test("keys that can't go in a request header are refused", () => {
    expect(licenseKeyFrom("KEY 1")).toBeUndefined();
    expect(licenseKeyFrom("KEY\n1")).toBeUndefined();
    expect(licenseKeyFrom("키-1")).toBeUndefined();
  });
});

/** cutfac.com, answering with `response`. */
const answering = (response: Response) => () => Promise.resolve(response);

describe("asking cutfac.com about a key", () => {
  test("a grant says when it ends, trial or not", async () => {
    const asked: { url: string; init: RequestInit }[] = [];

    const record = await fetchLicense("KEY-1", (url, init) => {
      asked.push({ url, init });

      return Promise.resolve(Response.json({ expiresAt: "2026-10-26T00:00:00.000Z", trial: true }));
    });

    expect(record).toEqual({
      checkedAt: expect.any(Number),
      expiresAt: Date.parse("2026-10-26T00:00:00.000Z"),
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(LICENSE_URL);
    expect(asked[0]?.init.headers).toEqual({ Authorization: "Bearer KEY-1" });
  });

  test("a plan with no end date stays open", async () => {
    const response = Response.json({ expiresAt: null, trial: false });

    expect(await fetchLicense("KEY-1", answering(response))).toMatchObject({ expiresAt: null });
  });

  test("401 and 402 refuse the key", async () => {
    const invalid = new Response("Invalid license key", { status: 401 });
    const ended = new Response("Plan ended", { status: 402 });

    expect(await fetchLicense("KEY-1", answering(invalid))).toMatchObject({ refusal: "invalid" });
    expect(await fetchLicense("KEY-1", answering(ended))).toMatchObject({ refusal: "ended" });
  });

  test("an unclear answer, or none, is no answer", async () => {
    const answers = [
      answering(new Response("Unavailable", { status: 503 })),
      answering(new Response("not json")),
      answering(Response.json({ expiresAt: "soon" })),
      answering(Response.json({ trial: true })),
      () => Promise.reject(new TypeError("fetch failed")),
    ];

    const records = await Promise.all(answers.map((request) => fetchLicense("KEY-1", request)));

    expect(records).toEqual(answers.map(() => undefined));
  });
});

/** What the app saved for the key: a grant, a refusal, or no answer yet. */
function savedAs(record: LicenseRecord | undefined): string {
  if (record === undefined) return "none";

  return "refusal" in record ? record.refusal : "grant";
}

interface Started {
  license: License;
  /** What happened, in order: cutfac.com asked about a key, settings saved, the board told. */
  events: string[];
}

/** The app's license with `key` saved, where cutfac.com gives `answers` in turn and then none. */
function start(key: string | undefined, record: LicenseRecord | undefined, answers: Response[]) {
  const events: string[] = [];
  const queue = [...answers];

  const license = startLicense({
    key,
    record,
    save: async (saved, answer) => {
      events.push(`save ${saved} ${savedAs(answer)}`);
    },
    onChange: () => events.push("change"),
    request: (_url, init) => {
      events.push(`ask ${new Headers(init.headers).get("Authorization")}`);
      const answer = queue.shift();

      return answer === undefined
        ? Promise.reject(new TypeError("fetch failed"))
        : Promise.resolve(answer);
    },
  });

  return { license, events } satisfies Started;
}

/** Lets the checks the app started run to the end. */
const settle = () => Bun.sleep(10);

const grant = (expiresAt: string | null = null) => Response.json({ expiresAt, trial: false });

describe("keeping the desktop app's plan", () => {
  beforeEach(() => setSystemTime(NOW));

  afterEach(() => setSystemTime());

  test("a grant at launch is saved before the board hears the plan changed", async () => {
    const { events } = start("KEY-1", undefined, [grant()]);

    await settle();

    expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change"]);
  });

  test("with no key, nothing is asked", async () => {
    const { license, events } = start(undefined, undefined, []);

    await settle();
    license.refresh();
    await settle();

    expect(events).toEqual([]);
    expect(license.hasKey()).toBe(false);
  });

  test("a key that names no license isn't kept", async () => {
    const { license, events } = start(undefined, undefined, [new Response("", { status: 401 })]);

    expect(await license.setKey("bad key")).toBe("invalid");
    expect(await license.setKey(" KEY-2 ")).toBe("invalid");
    expect(events).toEqual(["ask Bearer KEY-2"]);
    expect(license.hasKey()).toBe(false);
  });

  test("a new key cutfac.com couldn't answer for is kept on the free version", async () => {
    const { license, events } = start(undefined, undefined, []);

    expect(await license.setKey("KEY-2")).toBe("unavailable");
    expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 none"]);
    expect(license.hasKey()).toBe(true);
  });

  test("a granted key unlocks the paid plan", async () => {
    const { license, events } = start(undefined, undefined, [grant()]);

    expect(await license.setKey("KEY-2")).toBe("granted");
    expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 grant", "change"]);
  });

  test("coming back asks again about a key that isn't paid, at most once a minute", async () => {
    const ended: LicenseRecord = { checkedAt: NOW - HOUR, refusal: "ended" };
    const { license, events } = start("KEY-1", ended, [new Response("", { status: 402 }), grant()]);

    await settle();
    license.refresh();
    await settle();

    expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 ended"]);

    setSystemTime(NOW + 61_000);
    license.refresh();
    await settle();

    expect(events.slice(2)).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change"]);
  });

  test("coming back doesn't ask about a paid key, or one that names no license", async () => {
    const paid = start("KEY-1", { checkedAt: NOW, expiresAt: null }, [grant()]);

    const invalid = start("KEY-2", { checkedAt: NOW, refusal: "invalid" }, [
      new Response("", { status: 401 }),
    ]);

    await settle();
    setSystemTime(NOW + HOUR);
    paid.license.refresh();
    invalid.license.refresh();
    await settle();

    expect(paid.events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant"]);
    expect(invalid.events).toEqual(["ask Bearer KEY-2", "save KEY-2 invalid"]);
  });

  test("a grant running out moves the board to the free version", async () => {
    const until = new Date(NOW + HOUR).toISOString();

    const { license, events } = start("KEY-1", { checkedAt: NOW, expiresAt: NOW + HOUR }, [
      grant(until),
    ]);

    await settle();
    setSystemTime(NOW + 2 * HOUR);
    license.refresh();
    await settle();

    // Offline now, so the expired grant stands.
    expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change", "ask Bearer KEY-1"]);
  });
});
