import { Option, Schema } from "effect";

/**
 * How long a paid plan stays unlocked without hearing from cutfac.com. Past this, the desktop app
 * and the agent tools it bundles fall back to the free version until it hears again.
 */
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

/** cutfac.com vouched for the key: a plan until `expiresAt`, or with no end in sight. */
const LicenseGrant = Schema.Struct({
  checkedAt: Schema.Finite,
  expiresAt: Schema.NullOr(Schema.Finite),
});

/** cutfac.com said the key names no license, or one whose plan has ended. */
const LicenseRefusal = Schema.Struct({
  checkedAt: Schema.Finite,
  refusal: Schema.Literals(["invalid", "ended"]),
});

/** The last answer from cutfac.com about the saved key, kept next to it in the app's settings. */
export const LicenseRecord = Schema.Union([LicenseGrant, LicenseRefusal]);

export type LicenseRecord = typeof LicenseRecord.Type;

export const decodeLicenseRecord = Schema.decodeUnknownOption(LicenseRecord);

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeKey = Schema.decodeUnknownOption(Schema.NonEmptyString);

/**
 * Whether the key's last answer unlocks the paid plan at `now`: a grant that hasn't run out, heard
 * within the offline grace. Anything else is the free version.
 */
export function isPaid(record: LicenseRecord | undefined, now: number): boolean {
  if (record === undefined || "refusal" in record) return false;

  if (record.expiresAt !== null && record.expiresAt <= now) return false;

  return now - record.checkedAt <= OFFLINE_GRACE_MS;
}

/** Whether the desktop app's settings.json holds a key that unlocks the paid plan at `now`. */
export function paidInSettings(text: string, now: number): boolean {
  const settings = Option.getOrUndefined(decodeSettings(text));

  if (settings === undefined || Option.isNone(decodeKey(settings.licenseKey))) return false;

  return isPaid(Option.getOrUndefined(decodeLicenseRecord(settings.license)), now);
}
