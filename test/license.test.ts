import { describe, expect, test } from "bun:test";

import { licenseCheckOf, licenseKeyFrom } from "../electron/license.ts";

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
