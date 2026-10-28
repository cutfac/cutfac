import { Array, Option } from "effect";

import type { Locale } from "../i18n/locale.ts";
import { readStored, writeStored } from "./storage.ts";

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
 * The ids of the announcements the user has seen, from what the board kept: one per line. None
 * when the board hasn't opened here before.
 */
export const parseSeen = (stored: string | null): Option.Option<ReadonlyArray<string>> =>
  Option.map(Option.fromNullishOr(stored), (kept) => kept.split("\n").filter((id) => id !== ""));

/**
 * The announcement to show: the newest the user hasn't seen. None the first time the board opens,
 * since a new user hasn't missed anything; every announcement so far then counts as seen.
 */
export const unseen = (
  all: ReadonlyArray<Announcement>,
  seen: Option.Option<ReadonlyArray<string>>,
): Option.Option<Announcement> =>
  Option.flatMap(seen, (ids) =>
    Array.findFirst(all, (announcement) => !ids.includes(announcement.id)),
  );

/** Every announcement so far, as seen. */
const allSeen = (all: ReadonlyArray<Announcement>) => all.map((announcement) => announcement.id);

/** What was seen, less the newest announcement, so the board shows it again. */
export function forgetNewest(
  all: ReadonlyArray<Announcement>,
  seen: Option.Option<ReadonlyArray<string>>,
): ReadonlyArray<string> {
  const newest = Option.map(Array.head(all), ({ id }) => id);

  return Option.getOrElse(seen, () => allSeen(all)).filter((id) => !Option.contains(newest, id));
}

const listeners = new Set<() => void>();

/** What the board kept of the announcements seen, as stored. */
export const storedSeen = () => readStored(SEEN_KEY);

function saveSeen(seen: ReadonlyArray<string>): void {
  // When storage is blocked, the board shows none, as the first time it opens.
  writeStored(SEEN_KEY, seen.join("\n"));

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
