// Effect's Crypto has no signatures, and the plan is read synchronously.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { type KeyObject, createPublicKey, verify } from "node:crypto";

import { Option, Schema } from "effect";

/**
 * The public half of the Ed25519 key cutfac.com signs license grants with, so only a grant it made
 * unlocks the paid plan. Builds from source have no limit, so they need no way around it.
 */
export const LICENSE_PUBLIC_KEY = createPublicKey({
  key: Buffer.from("MCowBQYDK2VwAyEAQGBm1GPxoGiY9Gef8a06KpmLalt4VgpwjqftWiNM0Zw=", "base64"),
  format: "der",
  type: "spki",
});

/**
 * How long a paid plan stays unlocked without hearing from cutfac.com. Past this, the desktop app
 * and the agent tools it bundles fall back to the free version until it hears again.
 */
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

/** How far ahead of this Mac's clock cutfac.com's may be when it checks, as a clock running slow. */
const CLOCK_SKEW_MS = 24 * 60 * 60 * 1_000;

/** What cutfac.com signs: the key it checked, its time then, and when the plan ends, in epoch ms. */
const SignedGrant = Schema.Struct({
  key: Schema.String,
  checkedAt: Schema.Finite,
  expiresAt: Schema.NullOr(Schema.Finite),
});

export type SignedGrant = typeof SignedGrant.Type;

const decodeSignedGrant = Schema.decodeUnknownOption(Schema.fromJsonString(SignedGrant));

/** cutfac.com vouched for the key, in a token only it can sign. */
const LicenseGrant = Schema.Struct({ token: Schema.NonEmptyString });

/** cutfac.com said the key names no license, or one whose plan has ended. */
const LicenseRefusal = Schema.Struct({
  checkedAt: Schema.Finite,
  refusal: Schema.Literals(["invalid", "ended"]),
});

/**
 * The last answer from cutfac.com about the saved key, kept next to it in the app's settings. A
 * grant saved before grants were signed reads as no answer, until the app asks again.
 */
export const LicenseRecord = Schema.Union([LicenseGrant, LicenseRefusal]);

export type LicenseRecord = typeof LicenseRecord.Type;

export const decodeLicenseRecord = Schema.decodeUnknownOption(LicenseRecord);

/** The license key the desktop app saved, and cutfac.com's last answer about it. */
export interface SavedLicense {
  readonly key: string | undefined;
  readonly record: LicenseRecord | undefined;
}

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeKey = Schema.decodeUnknownOption(Schema.NonEmptyString);

/**
 * The grant in `token` if `publicKey` verifies that cutfac.com signed it. The token is the grant's
 * JSON and its signature, each in base64url, joined by a dot.
 */
export function openGrant(token: string, publicKey: KeyObject): SignedGrant | undefined {
  const [payload = "", signature = ""] = token.split(".");
  const bytes = Buffer.from(payload, "base64url");

  if (!verify(null, bytes, publicKey, Buffer.from(signature, "base64url"))) return undefined;

  return Option.getOrUndefined(decodeSignedGrant(bytes.toString()));
}

/**
 * Whether the saved key unlocks the paid plan at `now`: cutfac.com signed a grant for it that
 * hasn't run out, at a time within the offline grace. Anything else is the free version, including
 * a grant timed well after `now`, which a clock set back would show.
 */
export function isPaid(
  { key, record }: SavedLicense,
  now: number,
  publicKey = LICENSE_PUBLIC_KEY,
): boolean {
  if (key === undefined || record === undefined || "refusal" in record) return false;

  const grant = openGrant(record.token, publicKey);

  if (grant?.key !== key) return false;

  if (grant.expiresAt !== null && grant.expiresAt <= now) return false;

  const age = now - grant.checkedAt;

  return age >= -CLOCK_SKEW_MS && age <= OFFLINE_GRACE_MS;
}

/** Whether the desktop app's settings.json holds a key that unlocks the paid plan at `now`. */
export function paidInSettings(text: string, now: number, publicKey = LICENSE_PUBLIC_KEY): boolean {
  const settings = Option.getOrUndefined(decodeSettings(text));

  if (settings === undefined) return false;

  const saved = {
    key: Option.getOrUndefined(decodeKey(settings.licenseKey)),
    record: Option.getOrUndefined(decodeLicenseRecord(settings.license)),
  };

  return isPaid(saved, now, publicKey);
}
