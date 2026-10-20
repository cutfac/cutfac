import { Option, Schema } from "effect";

import { isPaid, type LicenseRecord } from "../src/license.ts";
import type { LicenseCheck } from "../web/src/desktop.ts";

/** Polar's keys are far shorter; anything longer is a paste gone wrong. */
const MAX_KEY_LENGTH = 128;

/** Keys travel in an HTTP header, which takes visible ASCII only. */
const KEY_CHARACTERS = /^[\x21-\x7e]+$/;

/** Where the app asks whether its key unlocks the paid plan. */
export const LICENSE_URL = "https://cutfac.com/api/license";

const CHECK_TIMEOUT_MS = 8_000;

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Coming back to the app asks again at most this often. */
const REFRESH_MS = 60 * 1_000;

// cutfac.com also says whether the license is a trial's, but any grant unlocks the same plan.
const decodeGrant = Schema.decodeUnknownOption(
  Schema.Struct({ expiresAt: Schema.NullOr(Schema.String) }),
);

/** The key as typed or pasted, without surrounding space, or undefined when it can't be one. */
export function licenseKeyFrom(input: string): string | undefined {
  const key = input.trim();

  return key.length <= MAX_KEY_LENGTH && KEY_CHARACTERS.test(key) ? key : undefined;
}

type Request = (url: string, init: RequestInit) => Promise<Response>;

/**
 * Asks cutfac.com about `key`: a grant, or a refusal for a key that names no license or one whose
 * plan has ended. Undefined when it couldn't be asked or gave no clear answer.
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

    return Number.isNaN(expiresAt) ? undefined : { checkedAt, expiresAt };
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
  /** The paid plan unlocked or ran out, once the settings that say so are saved. */
  onChange: () => void;
  /** How to reach cutfac.com; tests answer for it. */
  request?: Request;
}

export interface License {
  /** Checks a key from the board and keeps it unless it names no license. */
  setKey: (input: string) => Promise<LicenseCheck>;
  /** Catches up when the user comes back, asking again about a saved key that isn't paid now. */
  refresh: () => void;
  hasKey: () => boolean;
}

/**
 * Keeps cutfac.com's answer about the saved key fresh: asks at launch and once a day, and again
 * when the user comes back to a key that doesn't unlock the paid plan, perhaps after renewing or
 * getting online. Without the paid plan the app is the free version; it never locks.
 */
export function startLicense({
  key,
  record,
  save,
  onChange,
  request = fetch,
}: LicenseOptions): License {
  let saved = { key, record };

  let paid = isPaid(record, Date.now());

  let askedAt = Number.NEGATIVE_INFINITY;

  let checking: Promise<unknown> = Promise.resolve();

  /** Tells the board when the plan changed, which a grant running out does on its own. */
  function publish() {
    const next = isPaid(saved.record, Date.now());

    if (next === paid) return;

    paid = next;
    onChange();
  }

  /** Runs after any check in progress, so an answer about an old key never lands on a new one. */
  function serialize<A>(run: () => Promise<A>): Promise<A> {
    const next = checking.then(run);

    checking = next.catch(() => {});

    return next;
  }

  async function keep(next: typeof saved) {
    saved = next;

    // The board's server reads the plan from the saved settings, so they go first.
    if (next.key !== undefined) await save(next.key, next.record);

    publish();
  }

  const check = () => {
    askedAt = Date.now();

    return serialize(async () => {
      if (saved.key === undefined) return;

      const answer = await fetchLicense(saved.key, request);

      // No answer keeps the last one, which holds until its grace runs out.
      if (answer !== undefined) await keep({ key: saved.key, record: answer });
      else publish();
    });
  };

  void check();
  setInterval(() => void check(), DAY_MS).unref();

  return {
    setKey: (input) => {
      const next = licenseKeyFrom(input);

      if (next === undefined) return Promise.resolve("invalid");

      return serialize(async () => {
        const answer = await fetchLicense(next, request);
        const result = checkOf(answer);

        if (result === "invalid") return result;

        // An unconfirmed new key stays on the free version until cutfac.com answers for it.
        await keep({
          key: next,
          record: answer ?? (next === saved.key ? saved.record : undefined),
        });

        return result;
      });
    },
    refresh: () => {
      publish();

      // A key that names no license won't name one later; a new key goes through `setKey`.
      const invalid =
        saved.record !== undefined &&
        "refusal" in saved.record &&
        saved.record.refusal === "invalid";

      if (saved.key === undefined || paid || invalid || Date.now() - askedAt < REFRESH_MS) return;

      void check();
    },
    hasKey: () => saved.key !== undefined,
  };
}
