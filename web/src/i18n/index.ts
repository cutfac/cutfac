import { useSyncExternalStore } from "react";

import { desktop } from "../desktop.ts";
import { readStored, writeStored } from "../lib/storage.ts";
import { en, type Messages } from "./en.tsx";
import { ko } from "./ko.tsx";
import { resolveLocale, type Locale } from "./locale.ts";

export { isLocale, LOCALE_NAMES, LOCALES, type Locale } from "./locale.ts";

export type { Messages } from "./en.tsx";

const DICTIONARIES: Record<Locale, Messages> = { en, ko };

const STORAGE_KEY = "cutfac.locale";

let current = desktop?.locale() ?? resolveLocale(readStored(STORAGE_KEY), navigator.languages);

const listeners = new Set<() => void>();

/** Screen readers, spell checking and the desktop menu follow the language on screen. */
function apply(locale: Locale) {
  document.documentElement.lang = locale;
  desktop?.setLocale(locale);
}

apply(current);

export function setLocale(next: Locale) {
  if (next === current) return;

  current = next;
  writeStored(STORAGE_KEY, next);
  apply(next);

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

export const useLocale = (): Locale => useSyncExternalStore(subscribe, snapshot);

export const useMessages = (): Messages => DICTIONARIES[useLocale()];

/** The language at call time, for code that runs outside a render. */
export const currentLocale = (): Locale => current;

/** The copy at call time, for code that runs outside a render, such as a toast in a callback. */
export const messages = (): Messages => DICTIONARIES[current];
