import { Effect } from "effect";

import { editDir } from "./editFiles.ts";
import type { WorkspaceError } from "./errors.ts";
import type { Item } from "./items.ts";
import { type Entry, Workspace } from "./workspace.ts";

/** What Cutfac keeps in an item folder itself, which putting the agent's code back leaves alone. */
const CUTFAC_OWN = new Set(["item.yaml", "history", "edits", "review"]);

/** Folders of installed packages, which the agent's tools rebuild rather than edit. */
const PACKAGES = "node_modules";

/** Larger than code gets; a bigger file is footage or a render, which the media history covers. */
const CODE_BYTES = 2 * 1024 * 1024;

/**
 * More than an item's code holds, in files or in bytes, as when renders leave frames in the folder;
 * past either, saving it all on every request would cost more than it saves.
 */
const CODE_FILES = 500;

const CODE_TOTAL_BYTES = 20 * 1024 * 1024;

/** Where a request keeps the item's code as it was when the request was made. */
const codeDir = (item: Item, feedbackId: string) => `${editDir(item, feedbackId)}/code`;

interface Found {
  readonly path: string;
  readonly size: number;
}

/** The files under `root`, relative to it, leaving out the entries `skip` names and what's in them. */
const filesUnder = (
  root: string,
  skip: (path: string, entry: Entry) => boolean,
): Effect.Effect<Array<Found>, WorkspaceError, Workspace> =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const found: Array<Found> = [];

    const walk = (rel: string): Effect.Effect<void, WorkspaceError> =>
      Effect.gen(function* () {
        for (const entry of yield* ws.list(rel === "" ? root : `${root}/${rel}`)) {
          const path = rel === "" ? entry.name : `${rel}/${entry.name}`;

          if (skip(path, entry)) continue;

          if (entry.dir) yield* walk(path);
          else found.push({ path, size: entry.size });
        }
      });

    yield* walk("");

    return found;
  });

/**
 * Save the agent's code as it is now beside the request's "before" media, so putting the media
 * back can put the code back with it.
 */
export const saveCode = (item: Item, feedbackId: string) =>
  saveCodeTo(item, codeDir(item, feedbackId));

/**
 * Save the agent's code as it is now in `dir`: every file in the item but its media and Cutfac's
 * own. An item holding more than code does saves none.
 */
export const saveCodeTo = Effect.fnUntraced(function* (item: Item, dir: string) {
  const ws = yield* Workspace;
  const media = new Set(item.media.map((m) => m.name));

  const files = yield* filesUnder(
    item.dir,
    (path, entry) =>
      CUTFAC_OWN.has(path) ||
      media.has(path) ||
      entry.name === PACKAGES ||
      (!entry.dir && entry.size > CODE_BYTES),
  );

  const bytes = files.reduce((total, file) => total + file.size, 0);

  if (files.length > CODE_FILES || bytes > CODE_TOTAL_BYTES) return;

  yield* Effect.forEach(files, ({ path }) => ws.copy(`${item.dir}/${path}`, `${dir}/${path}`), {
    discard: true,
  });
});

/**
 * Put the agent's code back as the request found it. Files the request added stay, since Cutfac
 * never deletes what it didn't save; a request made before code was saved puts back nothing.
 */
export const restoreCode = (item: Item, feedbackId: string) =>
  restoreCodeFrom(item, codeDir(item, feedbackId));

/** Put the agent's code back as `saveCodeTo` saved it in `dir`; nothing when none was saved. */
export const restoreCodeFrom = Effect.fnUntraced(function* (item: Item, dir: string) {
  const ws = yield* Workspace;

  if (!(yield* ws.exists(dir))) return;
  const files = yield* filesUnder(dir, () => false);

  yield* Effect.forEach(files, ({ path }) => ws.copy(`${dir}/${path}`, `${item.dir}/${path}`), {
    discard: true,
  });
});
