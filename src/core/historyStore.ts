import { Effect } from "effect";

import type { WorkspaceError } from "./errors.ts";
import { HistoryDoc, type HistoryEntry } from "./historySchema.ts";
import type { Item } from "./items.ts";
import { Workspace } from "./workspace.ts";

/** Item subfolder with history.yaml and the media versions that are not edit snapshots. */
export const HISTORY_DIR = "history";

/** Changes kept for undo. Older ones drop off; the versions they point at stay listed. */
export const MAX_ENTRIES = 200;

const EMPTY: HistoryDoc = { cursor: 0, entries: [], versions: [], heads: {} };

const historyFile = (item: Item) => `${item.dir}/${HISTORY_DIR}/history.yaml`;

export const readHistory = Effect.fn("history.readHistory")(function* (item: Item) {
  const ws = yield* Workspace;
  const file = historyFile(item);

  return (yield* ws.exists(file)) ? yield* ws.readYaml(file, HistoryDoc) : EMPTY;
});

export type SaveHistory = (doc: HistoryDoc) => Effect.Effect<void, WorkspaceError>;

/**
 * Read-modify-write an item's history, one at a time per item, so changes recorded together do
 * not drop each other's entries. `change` writes with the `save` it is given, as often as it
 * needs. Not reentrant, and the history is locked before item.yaml: `change` may use `mutateItem`,
 * but nothing inside `mutateItem` may come here.
 */
export const mutateHistory = Effect.fn("history.mutateHistory")(function* <A, E, R>(
  item: Item,
  change: (doc: HistoryDoc, save: SaveHistory) => Effect.Effect<A, E, R>,
) {
  const ws = yield* Workspace;

  return yield* ws.exclusive(
    `history:${item.id}`,
    Effect.gen(function* () {
      const doc = yield* readHistory(item);

      return yield* change(doc, (next) => ws.writeYaml(historyFile(item), HistoryDoc, next));
    }),
  );
});

/** Add a change at the cursor. Changes that could still have been redone are dropped. */
export function pushEntry(doc: HistoryDoc, entry: HistoryEntry): HistoryDoc {
  const entries = [...doc.entries.slice(0, doc.cursor), entry];
  const dropped = Math.max(0, entries.length - MAX_ENTRIES);

  return { ...doc, entries: entries.slice(dropped), cursor: entries.length - dropped };
}
