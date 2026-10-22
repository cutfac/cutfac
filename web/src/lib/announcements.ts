import type { Locale } from "../i18n/locale.ts";

/** What an announcement says, in one language. */
export interface AnnouncementCopy {
  readonly title: string;
  readonly body: string;
  /** A button to the new thing: a board page such as `#/learn`, or a page on the web. */
  readonly action?: { readonly label: string; readonly href: string };
}

/**
 * Something new the board tells the user about, once, when it opens. Updates otherwise come in
 * quietly and every release's changes are at cutfac.com/changelog, so add one by hand only for a
 * change worth stopping the user for, such as a feature they wouldn't find on their own.
 */
export interface Announcement {
  /** Never reused: the board remembers by it which ones the user has seen. */
  readonly id: string;
  readonly copy: Readonly<Record<Locale, AnnouncementCopy>>;
}

/** Newest first. Ids are lowercase words joined by hyphens, such as `variant-compare`. */
export const ANNOUNCEMENTS: ReadonlyArray<Announcement> = [];

const SEEN_KEY = "cutfac.announcements.seen";

/**
 * The ids of the announcements the user has seen, from what the board kept: one per line.
 * Undefined when the board hasn't opened here before.
 */
export function parseSeen(stored: string | null): ReadonlyArray<string> | undefined {
  return stored?.split("\n").filter((id) => id !== "");
}

/**
 * The announcement to show: the newest the user hasn't seen. None the first time the board opens,
 * since a new user hasn't missed anything; every announcement so far then counts as seen.
 */
export function unseen(
  all: ReadonlyArray<Announcement>,
  seen: ReadonlyArray<string> | undefined,
): Announcement | undefined {
  if (seen === undefined) return undefined;

  return all.find((announcement) => !seen.includes(announcement.id));
}

/** Every announcement so far, as seen. */
const allSeen = (all: ReadonlyArray<Announcement>) => all.map((announcement) => announcement.id);

/** What was seen, less the newest announcement, so the board shows it again. */
export function forgetNewest(
  all: ReadonlyArray<Announcement>,
  seen: ReadonlyArray<string> | undefined,
): ReadonlyArray<string> {
  const newest = all[0]?.id;

  return (seen ?? allSeen(all)).filter((id) => id !== newest);
}

const listeners = new Set<() => void>();

/** What the board kept of the announcements seen, as stored. */
export function storedSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function saveSeen(seen: ReadonlyArray<string>): void {
  try {
    localStorage.setItem(SEEN_KEY, seen.join("\n"));
  } catch {
    // Storage can be blocked; the board then shows none, as the first time it opens.
  }

  for (const listener of listeners) listener();
}

/** Counts every announcement so far as seen. */
export const seeAll = () => saveSeen(allSeen(ANNOUNCEMENTS));

/** Forgets the user saw the newest announcement, so the board shows it again. */
export const showNewestAgain = () => saveSeen(forgetNewest(ANNOUNCEMENTS, parseSeen(storedSeen())));

/** Follows what was seen, here and in the app's other windows, such as the Dev Panel. */
export function subscribeSeen(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SEEN_KEY || event.key === null) listener();
  };

  listeners.add(listener);
  addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
}
