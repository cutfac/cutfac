import { Effect, Option } from "effect";

import { InvalidRequest, NotFound, type WorkspaceError } from "./errors.ts";
import type { Item } from "./items.ts";
import { extension, type MediaKind, mediaKind } from "./media.ts";
import { Workspace, type WorkspaceService } from "./workspace.ts";

/** The folder in an item for what the user hands the agent to work from: a logo, a script, photos. */
export const REFERENCES = "references";

/**
 * Where files the user hands an agent are kept: a folder inside what they belong to, such as an
 * item's `references/`. Paths to the files are relative to `owner`, such as `references/logo.png`.
 */
export interface ReferenceFolder {
  /** Workspace-relative: the item's folder, or whatever else the files belong to. */
  readonly owner: string;
  /** The folder inside `owner` that holds the files. */
  readonly name: string;
  /** Held while files are added, so two drops at once never take the same name. */
  readonly lock: string;
}

/** An item's references folder. */
export const itemReferences = (item: Item): ReferenceFolder => ({
  owner: item.dir,
  name: REFERENCES,
  lock: `references:${item.id}`,
});

export interface Reference {
  /** Relative to the folder's owner, such as `references/logo.png` in an item. */
  readonly path: string;
  readonly name: string;
  readonly dir: boolean;
  /** For a folder: how many files are in it, counted all the way down. */
  readonly files?: number | undefined;
  /** Bytes; for a folder, of everything in it. */
  readonly size: number;
  readonly mtime: number;
  /** Set for a picture or video, which the board shows as a thumbnail. */
  readonly kind?: MediaKind | undefined;
}

export interface ReferenceUpload {
  /** Where the file is now, such as an upload's temporary copy. */
  readonly source: string;
  /** Its path in what the user dropped: `logo.png`, or `photos/2024/a.jpg` inside a folder. */
  readonly path: string;
}

const segmentsOf = (path: string) =>
  Option.liftPredicate(
    path.split(/[/\\]/).filter((segment) => segment !== "" && segment !== "."),
    (segments) => !segments.includes(".."),
  );

/** Files and bytes in a folder, all the way down. */
const tally = (
  ws: WorkspaceService,
  rel: string,
): Effect.Effect<{ files: number; size: number }, WorkspaceError> =>
  Effect.gen(function* () {
    const counts = yield* Effect.forEach(
      yield* ws.list(rel),
      (entry) =>
        entry.dir
          ? tally(ws, `${rel}/${entry.name}`)
          : Effect.succeed({ files: 1, size: entry.size }),
      { concurrency: 4 },
    );

    return counts.reduce(
      (total, count) => ({ files: total.files + count.files, size: total.size + count.size }),
      { files: 0, size: 0 },
    );
  });

/** What is in a references folder, top level only; a folder is one entry. */
export const listReferences = Effect.fn("references.listReferences")(function* (
  folder: ReferenceFolder,
) {
  const ws = yield* Workspace;
  const root = `${folder.owner}/${folder.name}`;

  return yield* Effect.forEach(
    yield* ws.list(root),
    (entry) =>
      Effect.gen(function* () {
        const reference: Reference = {
          path: `${folder.name}/${entry.name}`,
          name: entry.name,
          dir: entry.dir,
          size: entry.size,
          mtime: entry.mtime,
          kind: entry.dir ? undefined : Option.getOrUndefined(mediaKind(entry.name)),
        };

        if (!entry.dir) return reference;

        const inner = yield* tally(ws, `${root}/${entry.name}`);

        return { ...reference, files: inner.files, size: inner.size };
      }),
    { concurrency: 4 },
  );
});

/**
 * `logo.png` → `logo-2.png`, `photos` → `photos-2`: the first name not in `taken`, which holds
 * lowercased names. Case is ignored because the Mac's disk treats `Logo.png` and `logo.png` as one
 * file.
 */
function freeName(name: string, dir: boolean, taken: ReadonlySet<string>): string {
  const ext = dir ? "" : extension(name);
  const stem = ext === "" ? name : name.slice(0, name.length - ext.length - 1);
  const suffix = name.slice(stem.length);
  let free = name;

  for (let n = 2; taken.has(free.toLowerCase()); n++) free = `${stem}-${n}${suffix}`;

  return free;
}

/**
 * Copy what the user dropped, pasted or picked into a references folder. A folder keeps its
 * structure; a name already taken gets a `-2`, `-3`… suffix. Dotfiles such as `.DS_Store` are
 * left out. Returns the paths of what was added, relative to the folder's owner, one per file or
 * folder.
 */
export const addReferences = Effect.fn("references.addReferences")(function* (
  folder: ReferenceFolder,
  uploads: ReadonlyArray<ReferenceUpload>,
) {
  const ws = yield* Workspace;
  const root = `${folder.owner}/${folder.name}`;

  /** Each dropped file is its own entry; files of one dropped folder go together. */
  const entries: Array<{ name: string; dir: boolean; files: ReferenceUpload[] }> = [];
  const folders = new Map<string, ReferenceUpload[]>();

  for (const upload of uploads) {
    const segments = segmentsOf(upload.path);

    if (Option.isNone(segments)) {
      return yield* new InvalidRequest({ message: `Not a path inside the drop: ${upload.path}` });
    }

    const [top, ...rest] = segments.value;

    if (top === undefined || segments.value.some((segment) => segment.startsWith("."))) continue;

    if (rest.length === 0) {
      entries.push({ name: top, dir: false, files: [{ ...upload, path: "" }] });
      continue;
    }

    const grouped = folders.get(top);
    const file = { ...upload, path: rest.join("/") };

    if (grouped === undefined) {
      const files = [file];
      folders.set(top, files);
      entries.push({ name: top, dir: true, files });
    } else {
      grouped.push(file);
    }
  }

  return yield* ws.exclusive(
    folder.lock,
    Effect.gen(function* () {
      const taken = new Set((yield* ws.list(root)).map((entry) => entry.name.toLowerCase()));
      const added: string[] = [];

      for (const entry of entries) {
        const name = freeName(entry.name, entry.dir, taken);
        taken.add(name.toLowerCase());

        for (const file of entry.files) {
          const to = file.path === "" ? `${root}/${name}` : `${root}/${name}/${file.path}`;
          yield* ws.importFile(file.source, to);
        }

        added.push(`${folder.name}/${name}`);
      }

      return added;
    }),
  );
});

const topLevelName = (path: string) =>
  Option.flatMap(segmentsOf(path), ([folder, name, ...rest]) =>
    folder === REFERENCES && rest.length === 0 ? Option.fromUndefinedOr(name) : Option.none(),
  );

/** Delete one file or folder from an item's references. */
export const removeReference = Effect.fn("references.removeReference")(function* (
  item: Item,
  path: string,
) {
  const ws = yield* Workspace;
  const name = topLevelName(path);

  if (Option.isNone(name)) {
    return yield* new InvalidRequest({ message: `Not a reference of the item: ${path}` });
  }

  const rel = `${item.dir}/${REFERENCES}/${name.value}`;

  if (!(yield* ws.exists(rel))) {
    return yield* new NotFound({ message: `No ${path} in ${item.id}` });
  }

  yield* ws.remove(rel);
});

/**
 * Check the files a request names as attachments: each must be in the item's references folder.
 * Returns them cleaned up (`references/./a.png` → `references/a.png`), or undefined for none.
 */
export const checkAttachments = Effect.fn("references.checkAttachments")(function* (
  dir: string,
  paths: ReadonlyArray<string> | undefined,
) {
  if (paths === undefined || paths.length === 0) return undefined;

  const ws = yield* Workspace;
  const checked: string[] = [];

  for (const path of paths) {
    const segments = Option.filter(
      segmentsOf(path),
      (inside) => inside.length >= 2 && inside[0] === REFERENCES,
    );

    if (Option.isNone(segments)) {
      return yield* new InvalidRequest({ message: `Attachments live in references/: ${path}` });
    }

    const clean = segments.value.join("/");

    if (!(yield* ws.exists(`${dir}/${clean}`))) {
      return yield* new NotFound({ message: `Attached file not found: ${path}` });
    }

    checked.push(clean);
  }

  return checked;
});
