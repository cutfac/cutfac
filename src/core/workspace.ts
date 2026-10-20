import {
  Context,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Schema,
  Semaphore,
  Stream,
} from "effect";
import type { PlatformError } from "effect/PlatformError";
import { parse, stringify } from "yaml";

import { WorkspaceError } from "./errors.ts";
import { WorkspaceConfig } from "./schema.ts";

export const CONFIG_FILE = "cutfac.yaml";

/** Where Cutfac keeps a workspace's own records that are not content, such as template imports. */
export const STATE_DIR = ".cutfac";

const LEGACY_CONFIG_FILE = "factory.yaml";

/**
 * What a workspace made before Content Factory was renamed to Cutfac calls these files, and their
 * names now. Opening the workspace renames them, unless something already has the new name.
 */
const RENAMED: ReadonlyArray<readonly [before: string, now: string]> = [
  [LEGACY_CONFIG_FILE, CONFIG_FILE],
  [".factory", STATE_DIR],
  [".agents/skills/content-factory", ".agents/skills/cutfac"],
  [".claude/skills/content-factory", ".claude/skills/cutfac"],
];

export interface FileStat {
  readonly size: number;
  /** Milliseconds since the epoch. */
  readonly mtime: number;
}

export interface Entry extends FileStat {
  readonly name: string;
  readonly dir: boolean;
}

/** What a look at a path the user named finds: a folder and its visible names, or a file. */
export type Peek =
  | { readonly dir: true; readonly names: ReadonlyArray<string> }
  | { readonly dir: false };

/**
 * Every filesystem read and write for a workspace goes through this service, so callers only
 * ever see workspace-relative paths and nothing can leave the root.
 */
export class Workspace extends Context.Service<
  Workspace,
  {
    readonly root: string;
    readonly config: WorkspaceConfig;
    /** Resolve a workspace-relative path, refusing anything that escapes the root. */
    readonly abs: (rel: string) => Effect.Effect<string, WorkspaceError>;
    /** The workspace-relative, `/`-separated form of an absolute path inside the root. */
    readonly rel: (abs: string) => string;
    readonly exists: (rel: string) => Effect.Effect<boolean, WorkspaceError>;
    readonly readText: (rel: string) => Effect.Effect<string, WorkspaceError>;
    readonly writeText: (rel: string, text: string) => Effect.Effect<void, WorkspaceError>;
    readonly writeBytes: (rel: string, bytes: Uint8Array) => Effect.Effect<void, WorkspaceError>;
    readonly readYaml: <A, I>(
      rel: string,
      schema: Schema.Codec<A, I>,
    ) => Effect.Effect<A, WorkspaceError>;
    readonly writeYaml: <A, I>(
      rel: string,
      schema: Schema.Codec<A, I>,
      value: A,
    ) => Effect.Effect<void, WorkspaceError>;
    readonly mkdir: (rel: string) => Effect.Effect<void, WorkspaceError>;
    readonly copy: (fromRel: string, toRel: string) => Effect.Effect<void, WorkspaceError>;
    /** Copy a folder and everything in it, keeping files already at the destination. */
    readonly copyTree: (fromRel: string, toRel: string) => Effect.Effect<void, WorkspaceError>;
    /** Copy a file from outside the workspace (an upload, a download, a CLI argument) into it. */
    readonly importFile: (source: string, toRel: string) => Effect.Effect<void, WorkspaceError>;
    readonly stat: (rel: string) => Effect.Effect<FileStat, WorkspaceError>;
    /** Direct children, without dotfiles, sorted by name. Empty when the folder is missing. */
    readonly list: (rel: string) => Effect.Effect<ReadonlyArray<Entry>, WorkspaceError>;
    readonly remove: (rel: string) => Effect.Effect<void, WorkspaceError>;
    /**
     * Look at an absolute path the user named, inside the workspace or not, without changing it.
     * Folder names come without dotfiles, sorted.
     */
    readonly peek: (full: string) => Effect.Effect<Peek, WorkspaceError>;
    /** Up to `maxBytes` from the start of a file the user named, inside the workspace or not. */
    readonly peekText: (full: string, maxBytes: number) => Effect.Effect<string, WorkspaceError>;
    /**
     * Run `effect` while no other effect holding `key` runs, such as two read-modify-writes of one
     * file. Not reentrant: `effect` must not take the same key.
     */
    readonly exclusive: <A, E, R>(
      key: string,
      effect: Effect.Effect<A, E, R>,
    ) => Effect.Effect<A, E, R>;
    /**
     * Workspace-relative paths that changed on disk, debounced, without dot folders, `dist`, or
     * `node_modules`. The stream ends if the platform cannot watch the folder.
     */
    readonly changes: Stream.Stream<string>;
  }
>()("cutfac/Workspace") {
  /** Open the workspace whose cutfac.yaml is in `start` or the nearest parent. */
  static readonly layer = (start: string) => Layer.effect(Workspace, open(start));
}

export type WorkspaceService = Workspace["Service"];

const IGNORED_SEGMENTS = new Set(["node_modules", "dist"]);

const ignoredChange = (rel: string) =>
  rel.split("/").some((segment) => segment.startsWith(".") || IGNORED_SEGMENTS.has(segment));

const reason = (error: PlatformError) => error.reason._tag;

const fail = (action: string, rel: string) => (error: PlatformError) =>
  new WorkspaceError({ message: `Could not ${action} ${rel} (${reason(error)})` });

/** Parse YAML text and decode it with `schema`. `label` names the source in errors. */
export const decodeYaml = Effect.fnUntraced(function* <A, I>(
  label: string,
  text: string,
  schema: Schema.Codec<A, I>,
) {
  const raw = yield* Effect.try({
    try: () => parse(text),
    catch: (cause) =>
      new WorkspaceError({ message: `${label} is not valid YAML: ${String(cause)}` }),
  });

  return yield* Schema.decodeUnknownEffect(schema)(raw ?? {}).pipe(
    Effect.mapError((error) => new WorkspaceError({ message: `${label}: ${error.message}` })),
  );
});

const pathExists = Effect.fnUntraced(function* (full: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.exists(full).pipe(Effect.orElseSucceed(() => false));
});

/** Whether `dir` holds a config file, current or from before the rename. */
const hasConfig = Effect.fnUntraced(function* (dir: string) {
  const path = yield* Path.Path;

  const found = yield* Effect.forEach([CONFIG_FILE, LEGACY_CONFIG_FILE], (name) =>
    pathExists(path.join(dir, name)),
  );

  return found.some(Boolean);
});

/** Find the folder holding the config file, starting at `start` and walking up. */
export const findRoot = Effect.fnUntraced(function* (start: string) {
  const path = yield* Path.Path;
  let dir = path.resolve(start);

  for (;;) {
    if (yield* hasConfig(dir)) return Option.some(dir);
    const parent = path.dirname(dir);

    if (parent === dir) return Option.none<string>();
    dir = parent;
  }
});

/**
 * Write cutfac.yaml into `dir` unless it is a workspace already. Returns whether it wrote one. This
 * and `appendAppRecord` are the only writes outside an opened workspace: this one is what makes
 * `dir` a workspace.
 */
export const initWorkspace = Effect.fn("Workspace.init")(function* (
  dir: string,
  config: typeof WorkspaceConfig.Encoded,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.join(dir, CONFIG_FILE);

  const failed = (error: PlatformError | Schema.SchemaError) =>
    new WorkspaceError({ message: `Could not create ${file}: ${error.message}` });

  if (yield* hasConfig(dir)) return false;

  const encoded = yield* Schema.decodeEffect(WorkspaceConfig)(config).pipe(
    Effect.flatMap(Schema.encodeEffect(WorkspaceConfig)),
    Effect.mapError(failed),
  );

  yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.mapError(failed));
  yield* fs
    .writeFileString(file, stringify(encoded, { lineWidth: 100 }))
    .pipe(Effect.mapError(failed));

  return true;
});

/**
 * Add a line to one of the desktop app's own records, which live in its data folder rather than in
 * any workspace, making the folder if it is missing.
 */
export const appendAppRecord = Effect.fn("Workspace.appendAppRecord")(function* (
  file: string,
  line: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const failed = (error: PlatformError) =>
    new WorkspaceError({ message: `Could not write ${file}: ${error.message}` });

  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.mapError(failed));
  yield* fs.writeFileString(file, `${line}\n`, { flag: "a" }).pipe(Effect.mapError(failed));
});

/** Give a file from before the rename its current name, unless something already has it. */
const moveRenamed = Effect.fnUntraced(function* (root: string, before: string, now: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const from = path.join(root, before);
  const to = path.join(root, now);

  if (!(yield* pathExists(from)) || (yield* pathExists(to))) return;

  // Another process opening the same workspace may have moved it first.
  yield* fs
    .rename(from, to)
    .pipe(
      Effect.catch((error) =>
        Effect.flatMap(pathExists(to), (moved) =>
          moved ? Effect.void : Effect.fail(fail("rename", `${before} to ${now}`)(error)),
        ),
      ),
    );
});

const open = Effect.fn("Workspace.open")(function* (start: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const found = yield* findRoot(start);

  if (Option.isNone(found)) {
    return yield* new WorkspaceError({
      message: `No ${CONFIG_FILE} found in ${start} or any parent. Run \`cutfac init\` first.`,
    });
  }

  const root = found.value;
  yield* Effect.forEach(RENAMED, ([before, now]) => moveRenamed(root, before, now), {
    discard: true,
  });

  const abs = (rel: string) =>
    Effect.suspend(() => {
      if (path.isAbsolute(rel)) {
        return Effect.fail(
          new WorkspaceError({ message: `Expected a workspace-relative path, got ${rel}` }),
        );
      }

      const full = path.resolve(root, rel);

      if (full !== root && !full.startsWith(root + path.sep)) {
        return Effect.fail(new WorkspaceError({ message: `Path escapes the workspace: ${rel}` }));
      }

      return Effect.succeed(full);
    });

  const rel = (full: string) => path.relative(root, full).split(path.sep).join("/");

  const ensureParent = (full: string, relPath: string) =>
    fs
      .makeDirectory(path.dirname(full), { recursive: true })
      .pipe(Effect.mapError(fail("create the folder for", relPath)));

  const exists = Effect.fn("Workspace.exists")(function* (relPath: string) {
    const full = yield* abs(relPath);

    return yield* fs.exists(full).pipe(Effect.mapError(fail("check", relPath)));
  });

  const readText = Effect.fn("Workspace.readText")(function* (relPath: string) {
    const full = yield* abs(relPath);

    return yield* fs.readFileString(full).pipe(Effect.mapError(fail("read", relPath)));
  });

  const writeText = Effect.fn("Workspace.writeText")(function* (relPath: string, text: string) {
    const full = yield* abs(relPath);
    yield* ensureParent(full, relPath);
    yield* fs.writeFileString(full, text).pipe(Effect.mapError(fail("write", relPath)));
  });

  const writeBytes = Effect.fn("Workspace.writeBytes")(function* (
    relPath: string,
    bytes: Uint8Array,
  ) {
    const full = yield* abs(relPath);
    yield* ensureParent(full, relPath);
    yield* fs.writeFile(full, bytes).pipe(Effect.mapError(fail("write", relPath)));
  });

  const readYaml = Effect.fn("Workspace.readYaml")(function* <A, I>(
    relPath: string,
    schema: Schema.Codec<A, I>,
  ) {
    const text = yield* readText(relPath);

    return yield* decodeYaml(relPath, text, schema);
  });

  const writeYaml = Effect.fn("Workspace.writeYaml")(function* <A, I>(
    relPath: string,
    schema: Schema.Codec<A, I>,
    value: A,
  ) {
    const encoded = yield* Schema.encodeEffect(schema)(value).pipe(
      Effect.mapError((error) => new WorkspaceError({ message: `${relPath}: ${error.message}` })),
    );

    yield* writeText(relPath, stringify(encoded, { lineWidth: 100 }));
  });

  const mkdir = Effect.fn("Workspace.mkdir")(function* (relPath: string) {
    const full = yield* abs(relPath);
    yield* fs
      .makeDirectory(full, { recursive: true })
      .pipe(Effect.mapError(fail("create", relPath)));
  });

  const copy = Effect.fn("Workspace.copy")(function* (fromRel: string, toRel: string) {
    const from = yield* abs(fromRel);
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs.copyFile(from, to).pipe(Effect.mapError(fail(`copy ${fromRel} to`, toRel)));
  });

  const copyTree = Effect.fn("Workspace.copyTree")(function* (fromRel: string, toRel: string) {
    const from = yield* abs(fromRel);
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs
      .copy(from, to, { overwrite: false })
      .pipe(Effect.mapError(fail(`copy ${fromRel} to`, toRel)));
  });

  const importFile = Effect.fn("Workspace.importFile")(function* (source: string, toRel: string) {
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs.copyFile(source, to).pipe(Effect.mapError(fail(`copy ${source} to`, toRel)));
  });

  const statFull = (full: string, relPath: string) =>
    fs.stat(full).pipe(
      Effect.mapError(fail("read", relPath)),
      Effect.map((info) => ({
        dir: info.type === "Directory",
        size: Number(info.size),
        mtime: Option.match(info.mtime, { onNone: () => 0, onSome: (date) => date.getTime() }),
      })),
    );

  const stat = Effect.fn("Workspace.stat")(function* (relPath: string) {
    const full = yield* abs(relPath);
    const info = yield* statFull(full, relPath);

    return { size: info.size, mtime: info.mtime };
  });

  const list = Effect.fn("Workspace.list")(function* (relPath: string) {
    const full = yield* abs(relPath);

    if (!(yield* fs.exists(full).pipe(Effect.mapError(fail("check", relPath))))) return [];
    const names = yield* fs.readDirectory(full).pipe(Effect.mapError(fail("list", relPath)));

    const visible = names
      .filter((name) => !name.startsWith("."))
      .toSorted((a, b) => a.localeCompare(b));

    // A file can disappear between listing and stat while an agent works; skip it.
    const entries = yield* Effect.forEach(
      visible,
      (name) =>
        statFull(path.join(full, name), `${relPath}/${name}`).pipe(
          Effect.map((info): Entry => ({ name, ...info })),
          Effect.option,
        ),
      { concurrency: 16 },
    );

    return entries.flatMap((entry) => Option.toArray(entry));
  });

  const remove = Effect.fn("Workspace.remove")(function* (relPath: string) {
    const full = yield* abs(relPath);
    yield* fs
      .remove(full, { recursive: true, force: true })
      .pipe(Effect.mapError(fail("remove", relPath)));
  });

  const peek = Effect.fn("Workspace.peek")(function* (full: string) {
    const info = yield* fs.stat(full).pipe(Effect.mapError(fail("read", full)));

    if (info.type !== "Directory") {
      const file: Peek = { dir: false };

      return file;
    }

    const names = yield* fs.readDirectory(full).pipe(Effect.mapError(fail("list", full)));

    const folder: Peek = {
      dir: true,
      names: names.filter((name) => !name.startsWith(".")).toSorted((a, b) => a.localeCompare(b)),
    };

    return folder;
  });

  const peekText = (full: string, maxBytes: number) =>
    fs
      .stream(full, { bytesToRead: maxBytes })
      .pipe(
        Stream.decodeText,
        Stream.mkString,
        Effect.mapError(fail("read", full)),
        Effect.withSpan("Workspace.peekText"),
      );

  const changes = fs.watch(root, { recursive: true }).pipe(
    Stream.map((event) => event.path.split(path.sep).join("/")),
    Stream.filter((changed) => !ignoredChange(changed)),
    Stream.debounce(Duration.millis(300)),
    Stream.catch((error) =>
      Stream.fromEffect(Effect.logWarning(`Not watching ${root}: ${error.message}`)).pipe(
        Stream.drain,
      ),
    ),
  );

  const config = yield* readYaml(CONFIG_FILE, WorkspaceConfig);
  const locks = new Map<string, Semaphore.Semaphore>();

  const exclusive = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) =>
    Effect.suspend(() => {
      const lock = locks.get(key) ?? Semaphore.makeUnsafe(1);
      locks.set(key, lock);

      return lock.withPermits(1)(effect);
    });

  return Workspace.of({
    root,
    config,
    abs,
    rel,
    exists,
    readText,
    writeText,
    writeBytes,
    readYaml,
    writeYaml,
    mkdir,
    copy,
    copyTree,
    importFile,
    stat,
    list,
    remove,
    peek,
    peekText,
    exclusive,
    changes,
  });
});

/** Names of the folders directly under `rel` that hold `file`, sorted by name. */
export const foldersWith = Effect.fn("Workspace.foldersWith")(function* (
  rel: string,
  file: string,
) {
  const ws = yield* Workspace;
  const entries = yield* ws.list(rel);

  // Effect.filter keeps matches in the order their checks finish; this keeps the listing's order.
  const found = yield* Effect.forEach(
    entries.filter((entry) => entry.dir),
    (entry) =>
      Effect.map(ws.exists(`${rel}/${entry.name}/${file}`), (has) => (has ? [entry.name] : [])),
    { concurrency: 8 },
  );

  return found.flat();
});

/** A file-system-safe, readable id fragment: `"Hello, World!"` → `hello-world`. */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    // Drop accents ("café" → "cafe") but recompose Hangul and other scripts NFKD splits apart.
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .normalize("NFC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");

  return slug === "" ? "untitled" : slug;
}

export const nowIso: Effect.Effect<string> = Effect.map(DateTime.now, DateTime.formatIso);
