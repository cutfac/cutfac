import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

import {
  LICENSE_URL,
  fetchLicense,
  licenseKeyFrom,
  startLicense,
  type License,
} from "../electron/license.ts";
import type { LicenseRecord } from "../src/license.ts";
import { licenseSigning, signedGrant } from "./support.ts";

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

const { publicKey } = licenseSigning;

type Request = (url: string, init: RequestInit) => Promise<Response>;

/** cutfac.com, answering with `response`. */
const answering = (response: Response) => () => Promise.resolve(response);

/** Asks about KEY-1 through `request`, checking grants with the tests' key. */
const ask = (request: Request) => fetchLicense("KEY-1", { request, publicKey });

/** cutfac.com's grant for `key`, as it answers now: the token and, for older apps, the end. */
const grant = (key = "KEY-1", expiresAt: number | null = null) =>
  Response.json({
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    trial: false,
    token: signedGrant(Date.now(), expiresAt, key),
  });

describe("asking cutfac.com about a key", () => {
  test("a grant is kept as the token cutfac.com signed", async () => {
    const asked: { url: string; init: RequestInit }[] = [];
    const token = signedGrant(Date.now());

    const record = await ask((url, init) => {
      asked.push({ url, init });

      return Promise.resolve(Response.json({ expiresAt: null, trial: true, token }));
    });

    expect(record).toEqual({ token });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(LICENSE_URL);
    expect(asked[0]?.init.headers).toEqual({ Authorization: "Bearer KEY-1" });
  });

  test("401 and 402 refuse the key", async () => {
    const invalid = new Response("Invalid license key", { status: 401 });
    const ended = new Response("Plan ended", { status: 402 });

    expect(await ask(answering(invalid))).toMatchObject({ refusal: "invalid" });
    expect(await ask(answering(ended))).toMatchObject({ refusal: "ended" });
  });

  test("an unclear answer, or none, is no answer", async () => {
    const answers = [
      answering(new Response("Unavailable", { status: 503 })),
      answering(new Response("not json")),
      answering(Response.json({ trial: true })),
      () => Promise.reject(new TypeError("fetch failed")),
    ];

    const records = await Promise.all(answers.map(ask));

    expect(records).toEqual(answers.map(() => undefined));
  });

  test("a grant that isn't signed for the key is no answer", async () => {
    const otherSigner = generateKeyPairSync("ed25519");

    const answers = [
      // From a server too old to sign.
      answering(Response.json({ expiresAt: null, trial: false })),
      answering(grant("KEY-2")),
      answering(Response.json({ token: signedGrant(Date.now(), null, "KEY-1", otherSigner) })),
      answering(Response.json({ token: "not a token" })),
    ];

    const records = await Promise.all(answers.map(ask));

    expect(records).toEqual(answers.map(() => undefined));
    // The app's own key, which no test holds the private half of.
    expect(await fetchLicense("KEY-1", { request: answering(grant()) })).toBeUndefined();
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
    publicKey,
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
    const { license, events } = start(undefined, undefined, [grant("KEY-2")]);

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
    const paid = start("KEY-1", { token: signedGrant(NOW) }, [grant()]);

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
    const { license, events } = start("KEY-1", { token: signedGrant(NOW, NOW + HOUR) }, [
      grant("KEY-1", NOW + HOUR),
    ]);

    await settle();
    setSystemTime(NOW + 2 * HOUR);
    license.refresh();
    await settle();

    // Offline now, so the expired grant stands.
    expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change", "ask Bearer KEY-1"]);
  });
});
