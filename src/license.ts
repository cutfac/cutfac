import { Option, Schema } from "effect";

/**
 * How long the desktop app, and the agent tools it bundles, keep working without hearing from
 * cutfac.com. The app asks at launch and once a day while it runs.
 */
export const OFFLINE_GRACE_MS = 7 * 24 * 60 * 60 * 1_000;

/** Where the locked app and its agent tools send people. The board keeps its own copy of these. */
export const PRICING_URL = "https://cutfac.com/pricing";

export const CUSTOMER_PORTAL_URL = "https://polar.sh/wyverselabs/portal";

/** cutfac.com vouched for the key: a trial until `expiresAt`, or a plan with no end in sight. */
const LicenseGrant = Schema.Struct({
  checkedAt: Schema.Finite,
  expiresAt: Schema.NullOr(Schema.Finite),
  trial: Schema.Boolean,
});

/** cutfac.com said the key names no license, or one whose trial or plan has ended. */
const LicenseRefusal = Schema.Struct({
  checkedAt: Schema.Finite,
  refusal: Schema.Literals(["invalid", "ended"]),
});

/** The last answer from cutfac.com about the saved key, kept next to it in the app's settings. */
export const LicenseRecord = Schema.Union([LicenseGrant, LicenseRefusal]);

export type LicenseRecord = typeof LicenseRecord.Type;

/**
 * Why the desktop app is locked: no key saved, a key that names no license, an ended trial or plan,
 * or no word from cutfac.com for longer than the offline grace.
 */
export const LicenseLock = Schema.Literals(["missing", "invalid", "ended", "offline"]);

export type LicenseLock = typeof LicenseLock.Type;

export const decodeLicenseRecord = Schema.decodeUnknownOption(LicenseRecord);

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

const decodeKey = Schema.decodeUnknownOption(Schema.NonEmptyString);

/** Why the app is locked at `now`, or undefined while it is open. */
export function licenseLock(
  hasKey: boolean,
  record: LicenseRecord | undefined,
  now: number,
): LicenseLock | undefined {
  if (!hasKey) return "missing";

  // A key saved while cutfac.com couldn't be reached waits for its first answer.
  if (record === undefined) return "offline";

  if ("refusal" in record) return record.refusal;

  if (record.expiresAt !== null && record.expiresAt <= now) return "ended";

  if (now - record.checkedAt > OFFLINE_GRACE_MS) return "offline";

  return undefined;
}

/**
 * When an open app locks if nothing new is heard: the trial's end or the end of the offline grace,
 * whichever comes first. Undefined when the record never changes on its own.
 */
export function lockChangesAt(record: LicenseRecord | undefined): number | undefined {
  if (record === undefined || "refusal" in record) return undefined;

  const offline = record.checkedAt + OFFLINE_GRACE_MS;

  return record.expiresAt === null ? offline : Math.min(record.expiresAt, offline);
}

/**
 * The lock the desktop app's settings.json describes at `now`. Undefined when the text isn't a
 * settings file at all: only the app locks itself, never a damaged file.
 */
export function lockInSettings(text: string, now: number): LicenseLock | undefined {
  const settings = Option.getOrUndefined(decodeSettings(text));

  if (settings === undefined) return undefined;

  return licenseLock(
    Option.isSome(decodeKey(settings.licenseKey)),
    Option.getOrUndefined(decodeLicenseRecord(settings.license)),
    now,
  );
}
