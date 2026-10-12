export const LOCALES = ["en", "ko"] as const;

export type Locale = (typeof LOCALES)[number];

/** Each language in its own words, so anyone can find theirs in the switcher. */
export const LOCALE_NAMES: Record<Locale, string> = { en: "English", ko: "한국어" };

export const isLocale = (value: string | null | undefined): value is Locale =>
  LOCALES.some((locale) => locale === value);

/**
 * The language to show: the one the user picked, else the first of their preferred languages the
 * app speaks (`ko-KR` counts as `ko`), else English.
 */
export function resolveLocale(
  stored: string | null | undefined,
  preferred: ReadonlyArray<string>,
): Locale {
  if (isLocale(stored)) return stored;

  for (const language of preferred) {
    const base = language.split("-")[0]?.toLowerCase();

    if (isLocale(base)) return base;
  }

  return "en";
}
