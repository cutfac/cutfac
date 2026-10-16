import { Option, Schema } from "effect";

import type { LicenseCheck } from "../web/src/desktop.ts";

/** Polar's keys are far shorter; anything longer is a paste gone wrong. */
const MAX_KEY_LENGTH = 128;

/** Keys travel in an HTTP header, which takes visible ASCII only. */
const KEY_CHARACTERS = /^[\x21-\x7e]+$/;

const decodeHttpStatus = Schema.decodeUnknownOption(Schema.Struct({ statusCode: Schema.Finite }));

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
