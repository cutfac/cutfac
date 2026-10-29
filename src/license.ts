// Effect's Crypto has no signatures.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { type KeyObject, createPublicKey, verify } from "node:crypto";

import { Clock, Context, Duration, Effect, Option, Redacted, Schema } from "effect";

import { RELEASED_AT } from "./core/released.ts";

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
 * When the running build was released, which a perpetual license's year of updates is held to.
 * Tests set their own.
 */
export const ReleasedAt = Context.Reference<number | null>("cutfac/ReleasedAt", {
  defaultValue: () => RELEASED_AT,
});

/** The key that verifies cutfac.com's license grants. Tests sign their own. */
export const LicensePublicKey = Context.Reference<KeyObject>("cutfac/LicensePublicKey", {
  defaultValue: () => LICENSE_PUBLIC_KEY,
});

/**
 * How long a paid plan stays unlocked without hearing from cutfac.com. Past this, the desktop app
 * and the agent tools it bundles fall back to the free version until it hears again.
 */
export const OFFLINE_GRACE = Duration.days(7);

/** How far ahead of this Mac's clock cutfac.com's may be when it checks, as a clock running slow. */
const CLOCK_SKEW = Duration.days(1);

/** A license key as the desktop app saved it, which the board checked when it was typed. */
export const LicenseKey = Schema.NonEmptyString.pipe(Schema.brand("LicenseKey"));

export type LicenseKey = typeof LicenseKey.Type;

/** A key held in memory, which prints as `<redacted>` so it can't slip into a log or an error report. */
export type SecretLicenseKey = Redacted.Redacted<LicenseKey>;

/**
 * What cutfac.com signs: the key it checked, its time then, when the plan ends, and for a perpetual
 * license when its updates end, in epoch ms. Grants from before perpetual licenses have no end of
 * updates.
 */
const SignedGrant = Schema.Struct({
  key: Schema.String,
  checkedAt: Schema.Finite,
  expiresAt: Schema.OptionFromNullOr(Schema.Finite),
  updatesUntil: Schema.optional(Schema.NullOr(Schema.Finite)),
});

type SignedGrant = typeof SignedGrant.Type;

const decodeSignedGrant = Schema.decodeUnknownOption(Schema.fromJsonString(SignedGrant));

/**
 * cutfac.com's answer about a key, as the app saves it. The settings file holds no tag, so a file
 * written by any version reads the same: a grant is told from a refusal by its fields.
 */
export const LicenseRecord = Schema.Union([
  /** cutfac.com vouched for the key, in a token only it can sign. */
  Schema.Struct({ _tag: Schema.tagDefaultOmit("LicenseGrant"), token: Schema.NonEmptyString }),
  /**
   * cutfac.com said the key names no license, or one whose plan has ended; or that a perpetual
   * license isn't activated on this Mac, or is already on as many Macs as it allows.
   */
  Schema.Struct({
    _tag: Schema.tagDefaultOmit("LicenseRefusal"),
    checkedAt: Schema.Finite,
    refusal: Schema.Literals(["invalid", "ended", "unactivated", "full"]),
  }),
]).pipe(Schema.toTaggedUnion("_tag"));

export type LicenseRecord = typeof LicenseRecord.Type;

/** A grant saved before grants were signed reads as no answer, until the app asks again. */
const decodeLicenseRecord = Schema.decodeUnknownOption(LicenseRecord);

/** The license key the desktop app saved, and cutfac.com's last answer about it. */
export interface SavedLicense {
  readonly key: Option.Option<SecretLicenseKey>;
  readonly record: Option.Option<LicenseRecord>;
}

const decodeKey = Schema.decodeUnknownOption(Schema.RedactedFromValue(LicenseKey));

/**
 * The license in the desktop app's settings. Each field is read on its own, so a value written by
 * another version does not lose the other.
 */
export const savedLicenseOf = (settings: Schema.JsonObject): SavedLicense => ({
  key: decodeKey(settings.licenseKey),
  record: decodeLicenseRecord(settings.license),
});

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/**
 * The grant in `token`, if `publicKey` verifies that cutfac.com signed it. The token is the grant's
 * JSON and its signature, each in base64url, joined by a dot.
 */
function openGrant(token: string, publicKey: KeyObject): Option.Option<SignedGrant> {
  const [payload = "", signature = ""] = token.split(".");
  const bytes = Buffer.from(payload, "base64url");

  if (!verify(null, bytes, publicKey, Buffer.from(signature, "base64url"))) return Option.none();

  return decodeSignedGrant(bytes.toString());
}

/** The grant in `token`, if cutfac.com signed it for `key`. */
export const grantFor = Effect.fnUntraced(function* (key: SecretLicenseKey, token: string) {
  const publicKey = yield* LicensePublicKey;

  return Option.filter(openGrant(token, publicKey), (grant) => grant.key === Redacted.value(key));
});

/** Whether a build released at `releasedAt` came out after `grant`'s updates ended. */
const releasedAfterUpdates = (grant: SignedGrant, releasedAt: number | null) =>
  releasedAt !== null &&
  grant.updatesUntil !== undefined &&
  grant.updatesUntil !== null &&
  releasedAt > grant.updatesUntil;

/**
 * Whether `grant` holds at `now` for a build released at `releasedAt`: it hasn't run out, the build
 * came out within its updates, and cutfac.com made it within the offline grace. A grant timed well
 * after `now`, which a clock set back would show, doesn't hold.
 */
const holdsAt = (now: number, releasedAt: number | null) => (grant: SignedGrant) => {
  if (Option.exists(grant.expiresAt, (end) => end <= now)) return false;

  if (releasedAfterUpdates(grant, releasedAt)) return false;

  const age = now - grant.checkedAt;

  return age >= -Duration.toMillis(CLOCK_SKEW) && age <= Duration.toMillis(OFFLINE_GRACE);
};

const tokenOf = LicenseRecord.match({
  LicenseGrant: (grant) => Option.some(grant.token),
  LicenseRefusal: () => Option.none<string>(),
});

/**
 * Whether the saved key unlocks the paid plan now: cutfac.com signed a grant for it that still
 * holds. Anything else is the free version.
 */
export const isPaid = Effect.fnUntraced(function* ({ key, record }: SavedLicense) {
  const saved = Option.all({ key, token: Option.flatMap(record, tokenOf) });

  if (Option.isNone(saved)) return false;

  const grant = yield* grantFor(saved.value.key, saved.value.token);

  return Option.exists(grant, holdsAt(yield* Clock.currentTimeMillis, yield* ReleasedAt));
});

/**
 * When the saved key's updates end, if cutfac.com signed it as a perpetual license's: a build
 * released after it runs as the free version.
 */
export const updatesUntil = Effect.fnUntraced(function* ({ key, record }: SavedLicense) {
  const saved = Option.all({ key, token: Option.flatMap(record, tokenOf) });

  if (Option.isNone(saved)) return Option.none<number>();

  const grant = yield* grantFor(saved.value.key, saved.value.token);

  return Option.flatMap(grant, ({ updatesUntil: until }) => Option.fromNullishOr(until));
});

/** Whether the desktop app's settings.json holds a key that unlocks the paid plan now. */
export const paidInSettings = (text: string) =>
  isPaid(
    Option.match(decodeSettings(text), {
      onNone: () => ({ key: Option.none(), record: Option.none() }),
      onSome: savedLicenseOf,
    }),
  );
