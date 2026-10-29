import { Clock, Effect, Match, Option, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { LicenseRecord, grantFor, type SecretLicenseKey } from "../src/license.ts";
import type { Mac } from "./thisMac.ts";

/** Where the app asks whether its key unlocks the paid plan. */
export const LICENSE_URL = "https://cutfac.com/api/license";

/** Where the app activates its Mac for a perpetual license, and frees it again. */
export const ACTIVATIONS_URL = `${LICENSE_URL}/activations`;

const REQUEST_TIMEOUT = "8 seconds";

// cutfac.com also says when the plan ends and whether it is a trial's, for apps from before grants
// were signed. The signed token says when it ends, and any grant unlocks the same plan.
const GrantReply = Schema.Struct({ token: Schema.NonEmptyString });

/** A perpetual license's activation, or none for a plan key, which needs none. */
const ActivationReply = Schema.Struct({ activation: Schema.NullOr(Schema.NonEmptyString) });

/** cutfac.com couldn't be asked about a key, or gave no clear answer. */
export class LicenseUnanswered extends Schema.TaggedError<LicenseUnanswered>()(
  "LicenseUnanswered",
  { message: Schema.String },
) {}

const unanswered = (error: { readonly message: string }) =>
  new LicenseUnanswered({ message: error.message });

const inTime = <A, R>(request: Effect.Effect<A, LicenseUnanswered, R>) =>
  request.pipe(
    Effect.timeoutOrElse({
      duration: REQUEST_TIMEOUT,
      orElse: () =>
        Effect.fail(new LicenseUnanswered({ message: "cutfac.com didn't answer in time" })),
    }),
  );

/**
 * The Mac a check comes from: the hash of its hardware ID, and the activation a perpetual license
 * holds there, if any. A check that names no Mac reads as an app from before activations.
 */
export interface CheckingMac {
  readonly machine: string;
  readonly activation: Option.Option<string>;
}

/** The grant in cutfac.com's reply, which only counts as an answer if it is signed for `key`. */
const grantIn = Effect.fnUntraced(function* (
  key: SecretLicenseKey,
  response: HttpClientResponse.HttpClientResponse,
) {
  const { token } = yield* HttpClientResponse.filterStatusOk(response).pipe(
    Effect.flatMap(HttpClientResponse.schemaBodyJson(GrantReply)),
    Effect.mapError(unanswered),
  );

  if (Option.isNone(yield* grantFor(key, token)))
    return yield* new LicenseUnanswered({ message: "The grant isn't signed for this key" });

  return LicenseRecord.cases.LicenseGrant.make({ token });
});

const fromMac = (mac: Option.Option<CheckingMac>) =>
  Option.match(mac, {
    onNone: () => (request: HttpClientRequest.HttpClientRequest) => request,
    onSome: ({ machine, activation }) =>
      HttpClientRequest.setHeaders({
        "Cutfac-Machine": machine,
        ...Option.match(activation, {
          onNone: () => ({}),
          onSome: (id) => ({ "Cutfac-Activation": id }),
        }),
      }),
  });

/**
 * Asks cutfac.com about `key` on `mac`: a grant, or a refusal for a key that names no license,
 * one whose plan has ended, or a perpetual license that isn't activated on the Mac.
 */
export const fetchLicense = Effect.fn("license.fetch")(function* (
  key: SecretLicenseKey,
  mac: Option.Option<CheckingMac>,
): Effect.fn.Return<LicenseRecord, LicenseUnanswered, HttpClient.HttpClient> {
  return yield* inTime(
    Effect.gen(function* () {
      const response = yield* HttpClient.execute(
        HttpClientRequest.get(LICENSE_URL).pipe(HttpClientRequest.bearerToken(key), fromMac(mac)),
      ).pipe(Effect.mapError(unanswered));

      const checkedAt = yield* Clock.currentTimeMillis;

      const refusal = (reason: "invalid" | "ended" | "unactivated") =>
        Effect.succeed(LicenseRecord.cases.LicenseRefusal.make({ checkedAt, refusal: reason }));

      return yield* Match.value(response.status).pipe(
        Match.when(401, () => refusal("invalid")),
        Match.when(402, () => refusal("ended")),
        Match.when(428, () => refusal("unactivated")),
        Match.orElse(() => grantIn(key, response)),
      );
    }),
  );
});

/** cutfac.com's answer to activating this Mac: the activation, or why the key can't have one here. */
export type Activated =
  | { readonly activation: Option.Option<string> }
  | { readonly refusal: "invalid" | "ended" | "full" };

/**
 * Activates `mac` for `key`. A perpetual license gets an activation tied to the Mac; a plan key
 * needs none. A license already on as many Macs as it allows is `full`.
 */
export const activateMac = Effect.fn("license.activate")(function* (
  key: SecretLicenseKey,
  mac: Mac,
): Effect.fn.Return<Activated, LicenseUnanswered, HttpClient.HttpClient> {
  return yield* inTime(
    Effect.gen(function* () {
      const request = yield* HttpClientRequest.post(ACTIVATIONS_URL).pipe(
        HttpClientRequest.bearerToken(key),
        HttpClientRequest.bodyJson({ label: mac.label, machine: mac.machine }),
        Effect.mapError(unanswered),
      );

      const response = yield* HttpClient.execute(request).pipe(Effect.mapError(unanswered));

      const refused = (refusal: "invalid" | "ended" | "full"): Effect.Effect<Activated> =>
        Effect.succeed({ refusal });

      return yield* Match.value(response.status).pipe(
        Match.when(401, () => refused("invalid")),
        Match.when(402, () => refused("ended")),
        Match.when(409, () => refused("full")),
        Match.orElse(() =>
          HttpClientResponse.filterStatusOk(response).pipe(
            Effect.flatMap(HttpClientResponse.schemaBodyJson(ActivationReply)),
            Effect.map(({ activation }): Activated => ({
              activation: Option.fromNullishOr(activation),
            })),
            Effect.mapError(unanswered),
          ),
        ),
      );
    }),
  );
});

/**
 * Frees the Mac `activation` names, so `key` can be activated on another. An activation or key
 * cutfac.com no longer knows has nothing left to free.
 */
export const deactivateMac = Effect.fn("license.deactivate")(function* (
  key: SecretLicenseKey,
  activation: string,
): Effect.fn.Return<void, LicenseUnanswered, HttpClient.HttpClient> {
  return yield* inTime(
    Effect.gen(function* () {
      const response = yield* HttpClient.execute(
        HttpClientRequest.delete(`${ACTIVATIONS_URL}/${encodeURIComponent(activation)}`).pipe(
          HttpClientRequest.bearerToken(key),
        ),
      ).pipe(Effect.mapError(unanswered));

      if (response.status === 204 || response.status === 401) return;

      return yield* new LicenseUnanswered({
        message: `cutfac.com answered ${response.status} to freeing the Mac`,
      });
    }),
  );
});
