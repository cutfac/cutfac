import { Option, Schema } from "effect";

import { licenseLock, lockChangesAt, type LicenseRecord } from "../src/license.ts";
// The board's copy of the lock, so a reason it can't show fails to compile here.
import type { LicenseCheck, LicenseLock } from "../web/src/desktop.ts";

/** Polar's keys are far shorter; anything longer is a paste gone wrong. */
const MAX_KEY_LENGTH = 128;

/** Keys travel in an HTTP header, which takes visible ASCII only. */
const KEY_CHARACTERS = /^[\x21-\x7e]+$/;

/** Where the app asks whether its key still opens it. */
export const LICENSE_URL = "https://cutfac.com/api/license";

const CHECK_TIMEOUT_MS = 8_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

const decodeHttpStatus = Schema.decodeUnknownOption(Schema.Struct({ statusCode: Schema.Finite }));

const decodeGrant = Schema.decodeUnknownOption(
  Schema.Struct({ expiresAt: Schema.NullOr(Schema.String), trial: Schema.Boolean }),
);

/** The key as typed or pasted, without surrounding space, or undefined when it can't be one. */
export function licenseKeyFrom(input: string): string | undefined {
  const key = input.trim();

  return key.length <= MAX_KEY_LENGTH && KEY_CHARACTERS.test(key) ? key : undefined;
}

/**
 * What a failed update check says about the key. cutfac.com answers 401 for a key that names no
 * license and 402 for one whose plan has ended. Anything else, from being offline to the site being
 * down, says nothing about the key.
 */
export function licenseCheckOf(cause: unknown): Exclude<LicenseCheck, "granted"> {
  const status = Option.getOrUndefined(decodeHttpStatus(cause))?.statusCode;

  if (status === 401) return "invalid";

  if (status === 402) return "ended";

  return "unavailable";
}

type Request = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Asks cutfac.com about `key`: a grant, or a refusal for a key that names no license or one whose
 * trial or plan has ended. Undefined when it couldn't be asked or gave no clear answer.
 */
export async function fetchLicense(
  key: string,
  request: Request = fetch,
): Promise<LicenseRecord | undefined> {
  try {
    const response = await request(LICENSE_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });

    const checkedAt = Date.now();

    if (response.status === 401) return { checkedAt, refusal: "invalid" };

    if (response.status === 402) return { checkedAt, refusal: "ended" };

    if (!response.ok) return undefined;

    const grant = Option.getOrUndefined(decodeGrant(await response.json()));

    if (grant === undefined) return undefined;

    const expiresAt = grant.expiresAt === null ? null : Date.parse(grant.expiresAt);

    return Number.isNaN(expiresAt) ? undefined : { checkedAt, expiresAt, trial: grant.trial };
  } catch {
    return undefined;
  }
}

/** What `check` says when the board takes a key. */
function checkOf(record: LicenseRecord | undefined): LicenseCheck {
  if (record === undefined) return "unavailable";

  return "refusal" in record ? record.refusal : "granted";
}

interface LicenseOptions {
  /** The saved key, and cutfac.com's last answer about it. */
  key: string | undefined;
  record: LicenseRecord | undefined;
  save: (key: string, record: LicenseRecord | undefined) => Promise<void>;
  /** The app locked, unlocked, or locked for another reason. */
  onLock: (lock: LicenseLock | undefined) => void;
  /** The board took a key that names a license, so update checks should send it. */
  onKey: (key: string) => void;
}

export interface License {
  /** Why the app is locked now, or undefined while it is open. */
  lock: () => LicenseLock | undefined;
  /** Checks a key from the board and keeps it unless it names no license. */
  setKey: (input: string) => Promise<LicenseCheck>;
  /** Asks cutfac.com again about the saved key, and resolves the lock after. */
  recheck: () => Promise<LicenseLock | undefined>;
  hasKey: () => boolean;
}

/**
 * Keeps the app's lock: asks cutfac.com about the saved key at launch and once a day, and locks
 * on its own when a trial ends or the app goes the offline grace without an answer.
 */
export function startLicense({ key, record, save, onLock, onKey }: LicenseOptions): License {
  let saved = { key, record };

  let published = lock();

  let timer: ReturnType<typeof setTimeout> | undefined;

  let checking: Promise<unknown> = Promise.resolve();

  let rechecking: Promise<void> | undefined;

  function lock() {
    return licenseLock(saved.key !== undefined, saved.record, Date.now());
  }

  /** Tells the board when the lock changed, and wakes up when it next would on its own. */
  function publish() {
    const next = lock();

    if (next !== published) {
      published = next;
      onLock(next);
    }

    clearTimeout(timer);

    const changesAt = lockChangesAt(saved.record);

    if (next !== undefined || changesAt === undefined) return;

    // A timer longer than about 24 days fires at once, and the daily check wakes it anyway.
    timer = setTimeout(publish, Math.min(changesAt - Date.now(), DAY_MS));
    timer.unref();
  }

  /** Runs after any check in progress, so an answer about an old key never lands on a new one. */
  function serialize<A>(run: () => Promise<A>): Promise<A> {
    const next = checking.then(run);

    checking = next.catch(() => {});

    return next;
  }

  async function keep(next: typeof saved) {
    saved = next;
    publish();

    if (next.key !== undefined) await save(next.key, next.record);
  }

  // Focusing the window while locked asks too; a check already on its way answers for all of them.
  const check = () =>
    (rechecking ??= serialize(async () => {
      if (saved.key === undefined) return;

      const answer = await fetchLicense(saved.key);

      // No answer keeps the last one, which holds until its grace runs out.
      if (answer !== undefined) await keep({ key: saved.key, record: answer });
      else publish();
    }).finally(() => {
      rechecking = undefined;
    }));

  publish();
  void check();
  setInterval(() => void check(), DAY_MS).unref();

  return {
    lock,
    setKey: (input) => {
      const next = licenseKeyFrom(input);

      if (next === undefined) return Promise.resolve("invalid");

      return serialize(async () => {
        const answer = await fetchLicense(next);
        const result = checkOf(answer);

        if (result === "invalid") return result;

        // An unconfirmed new key keeps the app locked until cutfac.com answers for it.
        await keep({
          key: next,
          record: answer ?? (next === saved.key ? saved.record : undefined),
        });
        onKey(next);

        return result;
      });
    },
    recheck: async () => {
      await check();

      return lock();
    },
    hasKey: () => saved.key !== undefined,
  };
}
