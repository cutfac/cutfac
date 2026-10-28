import { Array, Option } from "effect";

import type {
  DetailField,
  DetailsChange,
  Feedback,
  HistoryDoc,
  HistoryEntry,
  MediaVersion,
} from "../api.ts";
import type { Messages } from "../i18n/index.ts";

const FIELDS: ReadonlyArray<DetailField> = ["title", "status", "hook", "notes"];

/** Longest request quoted in a change's name; the rest is in the chat. */
const QUOTE_LENGTH = 48;

/** The change Undo would take back. */
export const undoable = (history: HistoryDoc): Option.Option<HistoryEntry> =>
  Array.get(history.entries, history.cursor - 1);

/** The change Redo would make again. */
export const redoable = (history: HistoryDoc): Option.Option<HistoryEntry> =>
  Array.get(history.entries, history.cursor);

export const changedFields = (entry: DetailsChange): DetailField[] =>
  FIELDS.filter((field) => Object.hasOwn(entry.after, field) || Object.hasOwn(entry.before, field));

/** The first line of a request, cut short enough to name a change. */
function quote(text: string): string {
  const line = text.trim().split("\n")[0] ?? "";

  return line.length > QUOTE_LENGTH ? `${line.slice(0, QUOTE_LENGTH - 1).trimEnd()}…` : line;
}

/** A change in a few words: the request behind an edit, or which fields changed. */
export function describeChange(
  entry: HistoryEntry,
  feedback: ReadonlyArray<Feedback>,
  t: Messages,
  locale: string,
): string {
  if (entry.kind === "details") {
    const fields = changedFields(entry);
    const { title, status } = entry.after;

    if (fields.length === 1 && title !== undefined) return t.history.renamed(title);

    if (fields.length === 1 && status !== undefined) return t.history.moved(t.status[status]);

    const names = fields.map((field) => t.history.fields[field]);

    return t.history.changed(new Intl.ListFormat(locale).format(names));
  }

  switch (entry.cause) {
    case "edit": {
      const request = feedback.find((f) => f.id === entry.feedbackId)?.body;

      return request === undefined
        ? t.history.editMedia(entry.media)
        : t.history.edit(quote(request));
    }

    case "restore":
      return t.history.rollback(entry.media);

    case "version":
      return t.history.version(entry.media);

    case "outside":
      return t.history.outside(entry.media);
  }
}

/** `now` is the change the item is at; `undone` ones are still there to redo. */
export type ChangeState = "done" | "now" | "undone";

export interface ChangeRow {
  entry: HistoryEntry;
  state: ChangeState;
}

function stateAt(index: number, cursor: number): ChangeState {
  if (index < cursor - 1) return "done";

  return index === cursor - 1 ? "now" : "undone";
}

/** The undo stack, newest first. */
export const changeRows = (history: HistoryDoc): ChangeRow[] =>
  history.entries
    .map((entry, index) => ({ entry, state: stateAt(index, history.cursor) }))
    .toReversed();

export interface VersionGroup {
  media: string;
  /** Newest first. */
  versions: MediaVersion[];
}

/** Saved versions, one group per media file in the order each was first saved. */
export function versionGroups(history: HistoryDoc): VersionGroup[] {
  const groups = new Map<string, MediaVersion[]>();

  for (const version of history.versions) {
    groups.set(version.media, [version, ...(groups.get(version.media) ?? [])]);
  }

  return [...groups].map(([media, versions]) => ({ media, versions }));
}

/** Whether the media file holds this version right now. */
export const inUse = (history: HistoryDoc, version: MediaVersion): boolean =>
  history.heads[version.media]?.version === version.id;
