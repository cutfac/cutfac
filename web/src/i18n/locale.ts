import { Option, Schema } from "effect";

export const LOCALES = ["en", "ko"] as const;

const Locale = Schema.Literals(LOCALES);

export type Locale = typeof Locale.Type;

/** Each language in its own words, so anyone can find theirs in the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ko: "한국어" };

export const isLocale = Schema.is(Locale);

const decodeLocale = Schema.decodeUnknownOption(Locale);

/**
 * The language to show: the one the user picked, else the first of their preferred languages the
 * app speaks (`ko-KR` counts as `ko`), else English.
 */
export function resolveLocale(
  stored: string | null | undefined,
  preferred: ReadonlyArray<string>,
): Locale {
  const picked = decodeLocale(stored);

  if (Option.isSome(picked)) return picked.value;

  for (const language of preferred) {
    const base = decodeLocale(language.split("-")[0]?.toLowerCase());

    if (Option.isSome(base)) return base.value;
  }

  return "en";
}
