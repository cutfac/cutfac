import { Array, Option } from "effect";

import { sameContent } from "../../../src/core/historySchema.ts";
import type { Feedback, HistoryDoc, HistoryEntry, MediaVersion } from "../api.ts";
import type { Messages } from "../i18n/index.ts";
import { targetOf } from "./target.ts";

/** Longest request quoted in a version's name; the rest is in the chat. */
const QUOTE_LENGTH = 48;

/** The change Undo would take back. */
export const undoable = (history: HistoryDoc): Option.Option<HistoryEntry> =>
  Array.get(history.entries, history.cursor - 1);

/** The change Redo would make again. */
export const redoable = (history: HistoryDoc): Option.Option<HistoryEntry> =>
  Array.get(history.entries, history.cursor);

/** The first line of a request, cut short enough to name a version by. */
export function quote(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";

  return line.length > QUOTE_LENGTH ? `${line.slice(0, QUOTE_LENGTH - 1).trimEnd()}…` : line;
}

/** What put a media file in a version. */
export type Origin = Pick<MediaVersion, "cause" | "feedbackId" | "variant" | "source">;

/**
 * What put a media file in `version`. Versions saved before they said so are told by the change
 * that led to them, and a file's first one is its original.
 */
export function originOf(history: HistoryDoc, version: MediaVersion): Origin {
  if (version.cause !== undefined) return version;

  const change = history.entries.findLast((e) => e.kind === "media" && e.to === version.id);

  if (change?.kind === "media") return { cause: change.cause, feedbackId: change.feedbackId };

  const first = history.versions.find((v) => v.media === version.media);

  return { cause: first?.id === version.id ? "original" : undefined };
}

/**
 * A version in a few words. A request's versions are listed under it, so they say only what
 * happened; `media` names the file when the item has more than one.
 */
export function describeVersion(origin: Origin, t: Messages, media?: string): string {
  switch (origin.cause) {
    case "original":
      return t.history.original(media);

    case "edit":
      return origin.variant ?? t.history.edited(media);

    case "restore":
      return t.history.rolledBack(media);

    case "version":
      return t.history.restored(media);

    case "outside":
      return t.history.outside(media);

    case undefined:
      return t.history.earlier;
  }
}

const versionById = (history: HistoryDoc, id: string | undefined) =>
  Array.findFirst(history.versions, (v) => v.id === id);

/** Whether `version` is the one its media file holds now. */
export const isHeld = (history: HistoryDoc, version: MediaVersion) =>
  history.heads[version.media]?.version === version.id;

/** A request's versions in a row, or one version no request made. */
export interface VersionBlock {
  readonly feedbackId: string | undefined;
  readonly versions: ReadonlyArray<MediaVersion>;
}

export interface VersionDay {
  readonly day: string;
  readonly blocks: ReadonlyArray<VersionBlock>;
}

/** Every version newest first, by day, with each request's versions in a row kept together. */
export function versionDays(history: HistoryDoc, dayOf: (at: string) => string): VersionDay[] {
  const days: Array<{
    day: string;
    blocks: Array<{ feedbackId: string | undefined; versions: MediaVersion[] }>;
  }> = [];

  for (const version of history.versions.toReversed()) {
    const day = dayOf(version.at);
    const { feedbackId } = originOf(history, version);
    const today = days.at(-1)?.day === day ? days.at(-1) : undefined;
    const last = today?.blocks.at(-1);

    if (today === undefined) days.push({ day, blocks: [{ feedbackId, versions: [version] }] });
    else if (feedbackId !== undefined && last?.feedbackId === feedbackId)
      last.versions.push(version);
    else today.blocks.push({ feedbackId, versions: [version] });
  }

  return days;
}

/** A moment that shows what a request changed: its box's frame, else the middle of its range. */
export function stillOf(request: Feedback): number | undefined {
  const { start, end, region } = targetOf(request);

  return region?.at ?? (start !== undefined && end !== undefined ? (start + end) / 2 : start);
}

/**
 * The version to put back for the moment a kept request left the video in: the last one it put in.
 * None while the file holds that content, or for a request not kept.
 */
export function pointOf(history: HistoryDoc, request: Feedback): Option.Option<MediaVersion> {
  const media = request.variants?.media ?? request.media;

  if (request.decision !== "approved" || media === undefined) return Option.none();

  const made = Array.findLast(history.versions, (v) => {
    const { cause, feedbackId } = originOf(history, v);

    return v.media === media && cause === "edit" && feedbackId === request.id;
  });

  const held = versionById(history, history.heads[media]?.version);

  return Option.filter(made, (version) =>
    Option.match(held, {
      onNone: () => true,
      onSome: (current) => !sameContent(history.versions, current, version),
    }),
  );
}
