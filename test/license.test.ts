import { describe, expect, test } from "bun:test";

import { LICENSE_URL, fetchLicense, licenseCheckOf, licenseKeyFrom } from "../electron/license.ts";

/** An error shaped like the updater's HttpError, which carries the response status. */
function httpError(statusCode: number): Error {
  return Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });
}

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

  test("the update server's refusals say what is wrong with the key", () => {
    expect(licenseCheckOf(httpError(401))).toBe("invalid");
    expect(licenseCheckOf(httpError(402))).toBe("ended");
  });

  test("any other failure says nothing about the key", () => {
    for (const cause of [
      httpError(403),
      httpError(503),
      new Error("net::ERR_INTERNET_DISCONNECTED"),
      "offline",
      undefined,
    ]) {
      expect(licenseCheckOf(cause)).toBe("unavailable");
    }
  });
});

/** cutfac.com, answering with `response`. */
const answering = (response: Response) => () => Promise.resolve(response);

describe("asking cutfac.com about a key", () => {
  test("a grant says whether it is a trial and when it ends", async () => {
    const asked: { url: string; init: RequestInit }[] = [];

    const record = await fetchLicense("KEY-1", (url, init) => {
      asked.push({ url, init });

      return Promise.resolve(Response.json({ expiresAt: "2026-10-26T00:00:00.000Z", trial: true }));
    });

    expect(record).toMatchObject({
      expiresAt: Date.parse("2026-10-26T00:00:00.000Z"),
      trial: true,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.url).toBe(LICENSE_URL);
    expect(asked[0]?.init.headers).toEqual({ Authorization: "Bearer KEY-1" });
  });

  test("a plan with no end date stays open", async () => {
    const response = Response.json({ expiresAt: null, trial: false });

    expect(await fetchLicense("KEY-1", answering(response))).toMatchObject({
      expiresAt: null,
      trial: false,
    });
  });

  test("401 and 402 refuse the key", async () => {
    const invalid = new Response("Invalid license key", { status: 401 });
    const ended = new Response("Trial or plan ended", { status: 402 });

    expect(await fetchLicense("KEY-1", answering(invalid))).toMatchObject({ refusal: "invalid" });
    expect(await fetchLicense("KEY-1", answering(ended))).toMatchObject({ refusal: "ended" });
  });

  test("an unclear answer, or none, is no answer", async () => {
    const answers = [
      answering(new Response("Unavailable", { status: 503 })),
      answering(new Response("not json")),
      answering(Response.json({ expiresAt: "soon", trial: false })),
      answering(Response.json({ trial: true })),
      () => Promise.reject(new TypeError("fetch failed")),
    ];

    const records = await Promise.all(answers.map((request) => fetchLicense("KEY-1", request)));

    expect(records).toEqual(answers.map(() => undefined));
  });
});
