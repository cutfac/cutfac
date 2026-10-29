import { describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";

// Each test builds the license it checks, with the saved key and answers that test needs.
// @effect-diagnostics strictEffectProvide:off
import { Effect, Layer, Option, Redacted } from "effect";
import { HttpClient, HttpClientError, HttpClientResponse, UrlParams } from "effect/http";
import { TestClock } from "effect/testing";

import { License, LicenseSettings, licenseKeyFrom } from "../electron/license.ts";
import {
  ACTIVATIONS_URL,
  LICENSE_URL,
  RENEWAL_URL,
  fetchLicense,
} from "../electron/licenseRequests.ts";
import { MacUnknown, ThisMac, machineOf, platformUuidIn } from "../electron/thisMac.ts";
import {
  LICENSE_PUBLIC_KEY,
  LicenseKey,
  LicensePublicKey,
  LicenseRecord,
  ReleasedAt,
  isPaid,
} from "../src/license.ts";
import { testEffect } from "./effect.ts";
import { signedGrant, signedPerpetualGrant, testLicenseKey } from "./support.ts";

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
const refused = (checkedAt: number, refusal: "invalid" | "ended" | "full") =>
  Option.some(LicenseRecord.cases.LicenseRefusal.make({ checkedAt, refusal }));

/** cutfac.com's grant for `key`, as it answers now: the token and, for older apps, the end. */
const grant = (key = "KEY-1", expiresAt: number | null = null) =>
  Response.json({
    expiresAt: expiresAt === null ? null : new Date(expiresAt).toISOString(),
    trial: false,
    token: signedGrant(NOW, expiresAt, key),
  });

/**
 * What happened, in order: cutfac.com asked about a key (with the activation it carried), asked to
 * activate or free this Mac, settings saved or cleared, the board told.
 */
type Events = string[];

/** Each request cutfac.com was asked, with the key and activation it carried. */
interface Asked {
  readonly url: string;
  readonly authorization: string | undefined;
  readonly activation: string | undefined;
  readonly machine: string | undefined;
}

/** This Mac, as the fake reads it. */
const MAC = { label: "Studio Mac", machine: "a".repeat(64) };

/** What one request to cutfac.com was, as the events show it. */
const eventOf = (
  method: string,
  url: string,
  authorization: string,
  activation: string,
  search: string,
) => {
  if (url === LICENSE_URL)
    return `ask ${authorization}${activation === "" ? "" : ` @${activation}`}`;

  if (method === "POST" && url === ACTIVATIONS_URL) return `activate ${authorization}`;

  if (url === RENEWAL_URL) return `renew ${authorization} ${search}`;

  return `free ${url.slice(ACTIVATIONS_URL.length + 1)}`;
};

/** cutfac.com, giving `answers` in turn and then none, as when offline. */
const site = (answers: Response[], asked: Asked[], events: Events = []) =>
  HttpClient.make((request) =>
    Effect.suspend(() => {
      const { authorization } = request.headers;
      const activation = request.headers["cutfac-activation"];
      const machine = request.headers["cutfac-machine"];
      const answer = answers.shift();

      asked.push({ url: request.url, authorization, activation, machine });
      events.push(
        eventOf(
          request.method,
          request.url,
          authorization ?? "",
          activation ?? "",
          `?${UrlParams.toString(request.urlParams)}`,
        ),
      );

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
  fetchLicense(KEY_1, Option.none()).pipe(
    Effect.option,
    Effect.provideService(HttpClient.HttpClient, site(answers, [])),
  );

describe("asking cutfac.com about a key", () => {
  it.effect("a grant is kept as the token cutfac.com signed", () =>
    Effect.gen(function* () {
      const asked: Asked[] = [];
      const token = signedGrant(NOW);
      const reply = Response.json({ expiresAt: null, trial: true, token });

      const record = yield* fetchLicense(KEY_1, Option.none()).pipe(
        Effect.provideService(HttpClient.HttpClient, site([reply], asked)),
      );

      expect(record).toEqual(LicenseRecord.cases.LicenseGrant.make({ token }));
      expect(asked).toEqual([
        {
          url: LICENSE_URL,
          authorization: "Bearer KEY-1",
          activation: undefined,
          machine: undefined,
        },
      ]);
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

/** What the license starts from: the saved key, cutfac.com's last answer, and this Mac. */
interface Start {
  readonly key?: string;
  readonly record?: Option.Option<LicenseRecord>;
  readonly activation?: string;
  /** Whether this Mac's hardware ID can be read. */
  readonly macKnown?: boolean;
}

/**
 * Runs `body` against the app's license at NOW, starting from `start`, where cutfac.com gives
 * `answers` in turn and then none. The body sees what the license did as it happens.
 */
const withLicense = <A, E>(
  start: Start,
  answers: Response[],
  body: (license: License["Service"], events: Events) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const events: Events = [];

    const settings = Layer.succeed(
      LicenseSettings,
      LicenseSettings.of({
        load: Effect.succeed({
          key: Option.map(Option.fromNullishOr(start.key), (text) =>
            Redacted.make(LicenseKey.make(text)),
          ),
          record: start.record ?? Option.none(),
          activation: Option.fromNullishOr(start.activation),
        }),
        save: (saved, answer, activation) =>
          Effect.sync(
            () =>
              void events.push(
                `save ${Redacted.value(saved)} ${savedAs(answer)}${Option.match(activation, {
                  onNone: () => "",
                  onSome: (id) => ` @${id}`,
                })}`,
              ),
          ),
        clear: Effect.sync(() => void events.push("clear")),
      }),
    );

    const thisMac = Layer.succeed(
      ThisMac,
      ThisMac.of({
        mac:
          start.macKnown === false
            ? Effect.fail(new MacUnknown({ message: "no ioreg" }))
            : Effect.succeed(MAC),
      }),
    );

    const license = License.layer(Effect.sync(() => void events.push("change"))).pipe(
      Layer.provide([
        settings,
        thisMac,
        Layer.succeed(HttpClient.HttpClient, site(answers, [], events)),
      ]),
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
    withLicense({ key: "KEY-1" }, [grant()], (_, events) =>
      Effect.gen(function* () {
        yield* launched;

        expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant", "change"]);
      }),
    ),
  );

  it.effect("with no key, nothing is asked", () =>
    withLicense({}, [], (license, events) =>
      Effect.gen(function* () {
        yield* launched;
        yield* license.refresh;

        expect(events).toEqual([]);
        expect(yield* license.hasKey).toBe(false);
      }),
    ),
  );

  it.effect("a key that names no license isn't kept", () =>
    withLicense({}, [new Response("", { status: 401 })], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("bad key")).toBe("invalid");
        expect(yield* license.setKey(" KEY-2 ")).toBe("invalid");
        expect(events).toEqual(["ask Bearer KEY-2"]);
        expect(yield* license.hasKey).toBe(false);
      }),
    ),
  );

  it.effect("a new key cutfac.com couldn't answer for is kept on the free version", () =>
    withLicense({}, [], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("KEY-2")).toBe("unavailable");
        expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 none"]);
        expect(yield* license.hasKey).toBe(true);
      }),
    ),
  );

  it.effect("a granted key unlocks the paid plan", () =>
    withLicense({}, [grant("KEY-2")], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("KEY-2")).toBe("granted");
        expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 grant", "change"]);
      }),
    ),
  );

  it.effect("coming back asks again about a key that isn't paid, at most once a minute", () =>
    withLicense(
      { key: "KEY-1", record: refused(NOW - HOUR, "ended") },
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
    withLicense({ key: "KEY-1", record: signed(NOW) }, [grant()], (license, events) =>
      Effect.gen(function* () {
        yield* comeBackLater(license);

        expect(events).toEqual(["ask Bearer KEY-1", "save KEY-1 grant"]);
      }),
    ),
  );

  it.effect("coming back doesn't ask about a key that names no license", () =>
    withLicense(
      { key: "KEY-2", record: refused(NOW, "invalid") },
      [new Response("", { status: 401 })],
      (license, events) =>
        Effect.gen(function* () {
          yield* comeBackLater(license);

          expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 invalid"]);
        }),
    ),
  );

  it.effect("a grant running out moves the board to the free version", () =>
    withLicense(
      { key: "KEY-1", record: signed(NOW, NOW + HOUR) },
      [grant("KEY-1", NOW + HOUR)],
      (license, events) =>
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

/** cutfac.com saying the perpetual license isn't activated on this Mac. */
const unactivated = () => new Response("This Mac isn't activated", { status: 428 });

/** cutfac.com's new activation for this Mac. */
const activatedAs = (id: string) => Response.json({ activation: id });

describe("activating a perpetual license on this Mac", () => {
  it.effect("a check carries this Mac's activation, and 428 says it isn't activated", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      const asked: Asked[] = [];

      const record = yield* fetchLicense(
        KEY_1,
        Option.some({ machine: MAC.machine, activation: Option.some("act-1") }),
      ).pipe(Effect.provideService(HttpClient.HttpClient, site([unactivated()], asked)));

      expect(record).toEqual(
        LicenseRecord.cases.LicenseRefusal.make({ checkedAt: NOW, refusal: "unactivated" }),
      );
      expect(asked).toEqual([
        {
          url: LICENSE_URL,
          authorization: "Bearer KEY-1",
          activation: "act-1",
          machine: MAC.machine,
        },
      ]);
    }),
  );

  it.effect("a new perpetual key activates this Mac, then unlocks the paid plan with it", () =>
    withLicense({}, [unactivated(), activatedAs("act-1"), grant("KEY-2")], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.setKey("KEY-2")).toBe("granted");
        expect(events).toEqual([
          "ask Bearer KEY-2",
          "activate Bearer KEY-2",
          "ask Bearer KEY-2 @act-1",
          "save KEY-2 grant @act-1",
          "change",
        ]);
      }),
    ),
  );

  it.effect(
    "every check names this Mac, so the server holds a perpetual license to activations",
    () =>
      Effect.gen(function* () {
        const asked: Asked[] = [];

        yield* fetchLicense(
          KEY_1,
          Option.some({ machine: MAC.machine, activation: Option.none() }),
        ).pipe(Effect.option, Effect.provideService(HttpClient.HttpClient, site([grant()], asked)));

        expect(asked).toEqual([
          {
            url: LICENSE_URL,
            authorization: "Bearer KEY-1",
            activation: undefined,
            machine: MAC.machine,
          },
        ]);
      }),
  );

  it.effect(
    "a license already on as many Macs as it allows is kept as full, on the free version",
    () =>
      withLicense({}, [unactivated(), new Response("", { status: 409 })], (license, events) =>
        Effect.gen(function* () {
          expect(yield* license.setKey("KEY-2")).toBe("full");
          expect(events).toEqual(["ask Bearer KEY-2", "activate Bearer KEY-2", "save KEY-2 full"]);
          expect(yield* license.hasKey).toBe(true);
        }),
      ),
  );

  it.effect(
    "coming back to a full license asks again, so freeing another Mac unlocks this one",
    () =>
      withLicense(
        { key: "KEY-1", record: refused(NOW - HOUR, "full") },
        [
          // At launch, still full.
          unactivated(),
          new Response("", { status: 409 }),
          // After another Mac was freed.
          unactivated(),
          activatedAs("act-1"),
          grant(),
        ],
        (license, events) =>
          Effect.gen(function* () {
            yield* launched;
            yield* TestClock.adjust("61 seconds");
            yield* license.refresh;

            expect(events).toEqual([
              "ask Bearer KEY-1",
              "activate Bearer KEY-1",
              "save KEY-1 full",
              "ask Bearer KEY-1",
              "activate Bearer KEY-1",
              "ask Bearer KEY-1 @act-1",
              "save KEY-1 grant @act-1",
              "change",
            ]);
          }),
      ),
  );

  it.effect("the saved activation goes with each check", () =>
    withLicense({ key: "KEY-1", activation: "act-1" }, [grant()], (_, events) =>
      Effect.gen(function* () {
        yield* launched;

        expect(events).toEqual(["ask Bearer KEY-1 @act-1", "save KEY-1 grant @act-1", "change"]);
      }),
    ),
  );

  it.effect("an activation freed elsewhere is replaced by a new one", () =>
    withLicense(
      { key: "KEY-1", activation: "act-1" },
      [unactivated(), activatedAs("act-2"), grant()],
      (_, events) =>
        Effect.gen(function* () {
          yield* launched;

          expect(events).toEqual([
            "ask Bearer KEY-1 @act-1",
            "activate Bearer KEY-1",
            "ask Bearer KEY-1 @act-2",
            "save KEY-1 grant @act-2",
            "change",
          ]);
        }),
    ),
  );

  it.effect(
    "a Mac whose hardware ID can't be read isn't activated, and stays on the free version",
    () =>
      withLicense({ macKnown: false }, [unactivated()], (license, events) =>
        Effect.gen(function* () {
          expect(yield* license.setKey("KEY-2")).toBe("unavailable");
          expect(events).toEqual(["ask Bearer KEY-2", "save KEY-2 none"]);
        }),
      ),
  );

  it.effect("a new key frees the Mac the old one held, once cutfac.com takes the new key", () =>
    withLicense(
      { key: "KEY-1", activation: "act-1" },
      [grant(), grant("KEY-2"), new Response(null, { status: 204 })],
      (license, events) =>
        Effect.gen(function* () {
          yield* launched;

          expect(yield* license.setKey("KEY-2")).toBe("granted");
          expect(events.slice(3)).toEqual(["ask Bearer KEY-2", "free act-1", "save KEY-2 grant"]);
        }),
    ),
  );
});

describe("deactivating this Mac", () => {
  it.effect("frees the activation, then forgets the key, moving to the free version", () =>
    withLicense(
      { key: "KEY-1", activation: "act-1" },
      [grant(), new Response(null, { status: 204 })],
      (license, events) =>
        Effect.gen(function* () {
          yield* launched;

          expect(yield* license.deactivate).toBe("deactivated");
          expect(events.slice(3)).toEqual(["free act-1", "clear", "change"]);
          expect(yield* license.hasKey).toBe(false);
        }),
    ),
  );

  it.effect("offline, nothing changes, so the Mac isn't left counted with no key", () =>
    withLicense({ key: "KEY-1", activation: "act-1" }, [grant()], (license, events) =>
      Effect.gen(function* () {
        yield* launched;

        expect(yield* license.deactivate).toBe("unavailable");
        expect(events.slice(3)).toEqual(["free act-1"]);
        expect(yield* license.hasKey).toBe(true);
      }),
    ),
  );

  it.effect("a plan key, which holds no activation, is just forgotten", () =>
    withLicense({ key: "KEY-1" }, [grant()], (license, events) =>
      Effect.gen(function* () {
        yield* launched;

        expect(yield* license.deactivate).toBe("deactivated");
        expect(events.slice(3)).toEqual(["clear", "change"]);
      }),
    ),
  );
});

describe("this Mac", () => {
  test("the hardware UUID is read from ioreg, and only its hash leaves the Mac", () => {
    const ioreg = `+-o J316sAP  <class IOPlatformExpertDevice>
    {
      "IOPlatformSerialNumber" = "C02XYZ"
      "IOPlatformUUID" = "4c4c4544-0042-3510-8051-b2c04f4d3132"
    }`;

    expect(platformUuidIn(ioreg)).toEqual(Option.some("4C4C4544-0042-3510-8051-B2C04F4D3132"));
    expect(platformUuidIn("no uuid here")).toEqual(Option.none());
    expect(machineOf("4C4C4544-0042-3510-8051-B2C04F4D3132")).toMatch(/^[0-9a-f]{64}$/u);
    expect(machineOf("4C4C4544-0042-3510-8051-B2C04F4D3132")).not.toContain("4C4C4544");
  });
});

/** A perpetual license's grant, as the app saved it. */
const perpetual = (checkedAt: number, updatesUntil: number) =>
  Option.some(
    LicenseRecord.cases.LicenseGrant.make({ token: signedPerpetualGrant(checkedAt, updatesUntil) }),
  );

const DAY = 24 * HOUR;

describe("a perpetual license's year of updates", () => {
  it.effect("a build released within it is paid; one released after runs as the free version", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      const saved = { key: Option.some(KEY_1), record: perpetual(NOW, NOW + DAY) };

      const releasedAt = (at: number | null) =>
        isPaid(saved).pipe(Effect.provideService(ReleasedAt, at));

      expect(yield* releasedAt(NOW + DAY)).toBe(true);
      expect(yield* releasedAt(NOW + DAY + 1)).toBe(false);
      // Builds from source, and the dev build, carry no release date.
      expect(yield* releasedAt(null)).toBe(true);
    }),
  );

  it.effect("a grant from before perpetual licenses holds any build", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(NOW);

      const saved = { key: Option.some(KEY_1), record: signed(NOW) };

      expect(yield* isPaid(saved).pipe(Effect.provideService(ReleasedAt, NOW + 365 * DAY))).toBe(
        true,
      );
    }),
  );

  it.effect("a build it covers is taken without asking cutfac.com", () =>
    withLicense({ key: "KEY-1", record: perpetual(NOW, NOW + DAY) }, [], (license, events) =>
      Effect.gen(function* () {
        yield* launched;
        events.splice(0);

        expect(yield* license.covers(NOW + DAY)).toBe(true);
        expect(yield* license.updatesEnd).toEqual(Option.some(NOW + DAY));
        expect(events).toEqual([]);
      }),
    ),
  );

  it.effect("before holding a build back, it asks again, which counts a renewal", () =>
    withLicense(
      { key: "KEY-1", record: perpetual(NOW, NOW + DAY), activation: "act-1" },
      [
        Response.json({ token: signedPerpetualGrant(NOW, NOW + DAY) }),
        Response.json({ token: signedPerpetualGrant(NOW, NOW + 400 * DAY) }),
      ],
      (license, events) =>
        Effect.gen(function* () {
          yield* launched;

          expect(yield* license.covers(NOW + 2 * DAY)).toBe(true);
          expect(events.slice(-2)).toEqual(["ask Bearer KEY-1 @act-1", "save KEY-1 grant @act-1"]);
        }),
    ),
  );

  it.effect("a renewal checkout is asked for with the key, in the board's language", () =>
    withLicense(
      { key: "KEY-1", record: perpetual(NOW, NOW + DAY) },
      [
        Response.json({ token: signedPerpetualGrant(NOW, NOW + DAY) }),
        Response.json({ url: "https://polar.sh/checkout/renewal" }),
      ],
      (license, events) =>
        Effect.gen(function* () {
          yield* launched;

          expect(yield* license.renewal("ko")).toEqual(
            Option.some("https://polar.sh/checkout/renewal"),
          );
          expect(events.at(-1)).toBe("renew Bearer KEY-1 ?locale=ko");
        }),
    ),
  );

  it.effect("with no key there's no renewal to ask for", () =>
    withLicense({}, [], (license, events) =>
      Effect.gen(function* () {
        expect(yield* license.renewal("en")).toEqual(Option.none());
        expect(events).toEqual([]);
      }),
    ),
  );
});
