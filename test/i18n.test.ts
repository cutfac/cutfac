import { describe, expect, test } from "bun:test";

import { Predicate } from "effect";

import { en } from "../web/src/i18n/en.tsx";
import type { Messages } from "../web/src/i18n/index.ts";
import { ko } from "../web/src/i18n/ko.tsx";
import { isLocale, resolveLocale } from "../web/src/i18n/locale.ts";

/** Copy that reads the same in every language: product and brand names, and an example address. */
const SAME_EVERYWHERE = new Set([
  "nav.appName",
  "setup.agents.claude",
  "setup.agents.codex",
  "start.whatToMake.material.placeholder",
]);

/** Every plain string in a dictionary, keyed by its dotted path. */
function strings(dictionary: Messages): Map<string, string> {
  const found = new Map<string, string>();
  const pending: Array<[string, unknown]> = Object.entries(dictionary);

  for (let next = pending.pop(); next; next = pending.pop()) {
    const [path, value] = next;

    if (Predicate.isString(value)) found.set(path, value);
    else if (Predicate.isObject(value))
      for (const [key, child] of Object.entries(value)) pending.push([`${path}.${key}`, child]);
  }

  return found;
}

describe("locale", () => {
  test("a saved choice wins over the system languages", () => {
    expect(resolveLocale("ko", ["en-US"])).toBe("ko");
    expect(resolveLocale("en", ["ko-KR"])).toBe("en");
  });

  test("otherwise the first system language the app speaks is used", () => {
    expect(resolveLocale(null, ["ko-KR", "en-US"])).toBe("ko");
    expect(resolveLocale(undefined, ["fr-FR", "KO"])).toBe("ko");
    expect(resolveLocale(null, ["fr-FR", "de"])).toBe("en");
    expect(resolveLocale(null, [])).toBe("en");
  });

  test("a saved value from another version is ignored", () => {
    expect(resolveLocale("ja", ["ko-KR"])).toBe("ko");
    expect(isLocale("ja")).toBe(false);
    expect(isLocale("ko")).toBe(true);
  });
});

describe("dictionaries", () => {
  test("Korean translates every string English has", () => {
    const korean = strings(ko);

    for (const [key, text] of strings(en)) {
      expect(korean.get(key)?.length ?? 0).toBeGreaterThan(0);

      if (!SAME_EVERYWHERE.has(key))
        expect({ key, text: korean.get(key) }).not.toEqual({ key, text });
    }
  });

  test("Korean offers as many starting points as English", () => {
    for (const scope of ["range", "box", "whole", "new"] as const) {
      expect(ko.composer.ideas[scope]).toHaveLength(en.composer.ideas[scope].length);
    }
  });
});
