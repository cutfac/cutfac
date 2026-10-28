import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

// Each test builds the license it checks, with the saved key and answers that test needs.
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";

import {
  LICENSE_URL,
  License,
  LicenseSettings,
  fetchLicense,
  licenseKeyFrom,
} from "../electron/license.ts";
import { LICENSE_PUBLIC_KEY, LicenseKey, LicensePublicKey, LicenseRecord } from "../src/license.ts";
import { testEffect } from "./effect.ts";
import { signedGrant, testLicenseKey } from "./support.ts";

const it = testEffect(testLicenseKey);

const NOW = Date.parse("2026-10-20T00:00:00Z");

const HOUR = 60 * 60 * 1_000;

const KEY_1 = Redacted.make(LicenseKey.make("KEY-1"));

const keyFrom = (text: string) =>
  Option.getOrUndefined(Option.map(licenseKeyFrom(text), Redacted.value));

describe("desktop license keys", () => {
  test("keys lose surrounding space; empty and oversized ones are refused", () => {
    expect(keyFrom("  KEY-1 \n")).toBe(LicenseKey.make("KEY-1"));
    expect(keyFrom("   ")).toBeUndefined();
    expect(keyFrom("K".repeat(128))).toHaveLength(128);
    expect(keyFrom("K".repeat(129))).toBeUndefined();
  });

  test("keys that can't go in a request header are refused", () => {
    expect(keyFrom("KEY 1")).toBeUndefined();
    expect(keyFrom("KEY\n1")).toBeUndefined();
    expect(keyFrom("키-1")).toBeUndefined();
  });
});

/** cutfac.com's grant for KEY-1, as the app saved it. */
const signed = (checkedAt: number, expiresAt: number | null = null) =>
  Option.some(LicenseRecord.cases.LicenseGrant.make({ token: signedGrant(checkedAt, expiresAt) }));

/** cutfac.com's refusal, as the app saved it. */
const refused = (checkedAt: number, refusal: "invalid" | "ended") =>
  Option.some(LicenseRecord.cases.LicenseRefusal.make({ checkedAt, refusal }));

/** cutfac.com's grant for `key`, as it answers now: the token and, for older apps, the end. */
const grant = (key = "KEY-1", expiresAt: number | null = null) =>
  Response.json({
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    trial: false,
    token: signedGrant(NOW, expiresAt, key),
  });

/** What happened, in order: cutfac.com asked about a key, settings saved, the board told. */
type Events = string[];

/** Each request cutfac.com was asked, with the key it carried. */
interface Asked {
  readonly url: string;
  readonly authorization: string | undefined;
}

/** cutfac.com, giving `answers` in turn and then none, as when offline. */
const site = (answers: Response[], asked: Asked[], events: Events = []) =>
  HttpClient.make((request) =>
    Effect.suspend(() => {
      const { authorization } = request.headers;
      const answer = answers.shift();

      asked.push({ url: request.url, authorization });
      events.push(`ask ${authorization}`);

      if (answer !== undefined) return Effect.succeed(HttpClientResponse.fromWeb(request, answer));

      return Effect.fail(
        new HttpClientError.HttpClientError({
          reason: new HttpClientError.TransportError({ request }),
        }),
      );
    }),
  );

/** cutfac.com's answer about KEY-1 when it replies `answers`, or none. */
const ask = (...answers: Response[]) =>
  fetchLicense(KEY_1).pipe(
    Effect.option,
    Effect.provideService(HttpClient.HttpClient, site(answers, [])),
  );

describe("asking cutfac.com about a key", () => {
  it.effect("a grant is kept as the token cutfac.com signed", () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const token = signedGrant(NOW);
      const reply = Response.json({ expiresAt: null, trial: true, token });

      const record = yield* fetchLicense(KEY_1).pipe(
        Effect.provideService(HttpClient.HttpClient, site([reply], asked)),
      );

      expect(record).toEqual(LicenseRecord.cases.LicenseGrant.make({ token }));
      expect(asked).toEqual([{ url: LICENSE_URL, authorization: "Bearer KEY-1" }]);
    }),
  );

  it.effect("401 and 402 refuse the key", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      expect(yield* ask(new Response("Invalid license key", { status: 401 }))).toEqual(
        refused(NOW, "invalid"),
      );
      expect(yield* ask(new Response("Plan ended", { status: 402 }))).toEqual(
        refused(NOW, "ended"),
      );
    }),
  );

  it.effect("an unclear answer, or none, is no answer", () =>
    Effect.gen(function* () {
      const unclear = [
        new Response("Unavailable", { status: 503 }),
        new Response("not json"),
        Response.json({ trial: true }),
      ];

      expect(yield* Effect.forEach(unclear, (answer) => ask(answer))).toEqual(
        unclear.map(() => Option.none()),
      );
      expect(yield* ask()).toEqual(Option.none());
    }),
  );

  it.effect("a grant that isn't signed for the key is no answer", () =>
    Effect.gen(function* () {
      const otherSigner = generateKeyPairSync("ed25519");

      const unsigned = [
        // From a server too old to sign.
        Response.json({ expiresAt: null, trial: false }),
        grant("KEY-2"),
        Response.json({ token: signedGrant(NOW, null, "KEY-1", otherSigner) }),
        Response.json({ token: "not a token" }),
      ];

      // The app's own key, which no test holds the private half of.
      const appKey = ask(grant()).pipe(Effect.provideService(LicensePublicKey, LICENSE_PUBLIC_KEY));

      expect(yield* Effect.forEach(unsigned, (answer) => ask(answer))).toEqual(
        unsigned.map(() => Option.none()),
      );
      expect(yield* appKey).toEqual(Option.none());
    }),
  );
});

/** What the app saved for the key: a grant, a refusal, or no answer yet. */
const savedAs = Option.match({
  onNone: () => "none",
  onSome: LicenseRecord.match({
    LicenseGrant: () => "grant",
    LicenseRefusal: ({ refusal }) => refusal,
  }),
});

/**
 * Runs `body` against the app's license at NOW, with `key` and `record` saved, where cutfac.com
 * gives `answers` in turn and then none. The body sees what the license did as it happens.
 */
const withLicense = <A, E>(
  key: string | undefined,
  record: Option.Option<LicenseRecord>,
  answers: Response[],
  body: (license: License["Service"], events: Events) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const events: Events = [];

    const settings = Layer.succeed(
      LicenseSettings,
      LicenseSettings.of({
        load: Effect.succeed({
          key: Option.map(Option.fromNullishOr(key), (text) =>
            Redacted.make(LicenseKey.make(text)),
          ),
          record,
        }),
        save: (saved, answer) =>
          Effect.sync(() => void events.push(`save ${Redacted.value(saved)} ${savedAs(answer)}`)),
      }),
    );

    const license = License.layer(Effect.sync(() => void events.push("change"))).pipe(
      Layer.provide([settings, Layer.succeed(HttpClient.HttpClient, site(answers, [], events))]),
    );

    yield* TestClock.setTime(NOW);

    return yield* Effect.flatMap(License, (built) => body(built, events)).pipe(
      Effect.provide(license),
    );
  });

/** Lets the check the license started at launch run to the end. */
const launched = Effect.yieldNow;

/** Comes back to the app an hour after it launched. */
const comeBackLater = (license: License["Service"]) =>
  Effect.gen(function* () {
    yield* launched;
    yield* TestClock.adjust(HOUR);
    yield* license.refresh;
  });

describe("keeping the desktop app's plan", () => {
  it.effect("a grant at launch is saved before the board hears the plan changed", () =>
    withLicense("KEY-1", Option.none(), [grant()], (_, events) =>
      Effect.gen(function* () {
        yield* launched;

        expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change"]);
      }),
    ),
  );

  it.effect("with no key, nothing is asked", () =>
    withLicense(undefined, Option.none(), [], (license, events) =>
      Effect.gen(function* () {
        yield* launched;
        yield* license.refresh;

        expect(events).toEqual([]);
        expect(yield* license.hasKey).toBe(false);
      }),
    ),
  );

  it.effect("a key that names no license isn't kept", () =>
    withLicense(undefined, Option.none(), [new Response("", { status: 401 })], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("bad key")).toBe("invalid");
        expect(yield* license.setKey(" KEY-2 ")).toBe("invalid");
        expect(events).toEqual(["ask Bearer KEY-2"]);
        expect(yield* license.hasKey).toBe(false);
      }),
    ),
  );

  it.effect("a new key cutfac.com couldn't answer for is kept on the free version", () =>
    withLicense(undefined, Option.none(), [], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("KEY-2")).toBe("unavailable");
        expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 none"]);
        expect(yield* license.hasKey).toBe(true);
      }),
    ),
  );

  it.effect("a granted key unlocks the paid plan", () =>
    withLicense(undefined, Option.none(), [grant("KEY-2")], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("KEY-2")).toBe("granted");
        expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 grant", "change"]);
      }),
    ),
  );

  it.effect("coming back asks again about a key that isn't paid, at most once a minute", () =>
    withLicense(
      "KEY-1",
      refused(NOW - HOUR, "ended"),
      [new Response("", { status: 402 }), grant()],
      (license, events) =>
        Effect.gen(function* () {
          yield* launched;
          yield* license.refresh;

          expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 ended"]);

          yield* TestClock.adjust("61 seconds");
          yield* license.refresh;

          expect(events.slice(2)).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change"]);
        }),
    ),
  );

  it.effect("coming back doesn't ask about a paid key", () =>
    withLicense("KEY-1", signed(NOW), [grant()], (license, events) =>
      Effect.gen(function* () {
        yield* comeBackLater(license);

        expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant"]);
      }),
    ),
  );

  it.effect("coming back doesn't ask about a key that names no license", () =>
    withLicense(
      "KEY-2",
      refused(NOW, "invalid"),
      [new Response("", { status: 401 })],
      (license, events) =>
        Effect.gen(function* () {
          yield* comeBackLater(license);

          expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 invalid"]);
        }),
    ),
  );

  it.effect("a grant running out moves the board to the free version", () =>
    withLicense("KEY-1", signed(NOW, NOW + HOUR), [grant("KEY-1", NOW + HOUR)], (license, events) =>
      Effect.gen(function* () {
        yield* launched;
        yield* TestClock.adjust(2 * HOUR);
        yield* license.refresh;

        // Offline now, so the expired grant stands.
        expect(events).toEqual([
          "ask Bearer KEY-1",
          "save KEY-1 grant",
          "change",
          "ask Bearer KEY-1",
        ]);
      }),
    ),
  );
});
