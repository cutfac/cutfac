import {
  Context,
  Crypto,
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
import {
  CONFIG_FILE,
  fileFailure,
  findRoot,
  renameLegacyFiles,
  replaceFile,
} from "./workspaceRoot.ts";

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
    /** Up to `maxBytes` of a file the user named, as bytes, such as an image. */
    readonly peekBytes: (
      full: string,
      maxBytes: number,
    ) => Effect.Effect<Uint8Array, WorkspaceError>;
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

/** Parse YAML text and decode it with `schema`. `label` names the source in errors. */
const decodeYaml = Effect.fnUntraced(function* <A, I>(
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

const open = Effect.fn("Workspace.open")(function* (start: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const services = yield* Effect.context<FileSystem.FileSystem | Path.Path | Crypto.Crypto>();
  const found = yield* findRoot(start);

  if (Option.isNone(found)) {
    return yield* new WorkspaceError({
      message: `No ${CONFIG_FILE} found in ${start} or any parent. Run \`cutfac init\` first.`,
    });
  }

  const root = found.value;
  yield* renameLegacyFiles(root);

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
      .pipe(Effect.mapError(fileFailure("create the folder for", relPath)));

  const replace = (
    relPath: string,
    full: string,
    write: (temp: string) => Effect.Effect<void, PlatformError>,
  ) =>
    replaceFile(full, write).pipe(
      Effect.provideContext(services),
      Effect.mapError(fileFailure("write", relPath)),
    );

  const exists = Effect.fn("Workspace.exists")(function* (relPath: string) {
    const full = yield* abs(relPath);

    return yield* fs.exists(full).pipe(Effect.mapError(fileFailure("check", relPath)));
  });

  const readText = Effect.fn("Workspace.readText")(function* (relPath: string) {
    const full = yield* abs(relPath);

    return yield* fs.readFileString(full).pipe(Effect.mapError(fileFailure("read", relPath)));
  });

  const writeText = Effect.fn("Workspace.writeText")(function* (relPath: string, text: string) {
    const full = yield* abs(relPath);
    yield* ensureParent(full, relPath);
    yield* replace(relPath, full, (temp) => fs.writeFileString(temp, text));
  });

  const writeBytes = Effect.fn("Workspace.writeBytes")(function* (
    relPath: string,
    bytes: Uint8Array,
  ) {
    const full = yield* abs(relPath);
    yield* ensureParent(full, relPath);
    yield* replace(relPath, full, (temp) => fs.writeFile(temp, bytes));
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
      .pipe(Effect.mapError(fileFailure("create", relPath)));
  });

  const copy = Effect.fn("Workspace.copy")(function* (fromRel: string, toRel: string) {
    const from = yield* abs(fromRel);
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs.copyFile(from, to).pipe(Effect.mapError(fileFailure(`copy ${fromRel} to`, toRel)));
  });

  const copyTree = Effect.fn("Workspace.copyTree")(function* (fromRel: string, toRel: string) {
    const from = yield* abs(fromRel);
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs
      .copy(from, to, { overwrite: false })
      .pipe(Effect.mapError(fileFailure(`copy ${fromRel} to`, toRel)));
  });

  const importFile = Effect.fn("Workspace.importFile")(function* (source: string, toRel: string) {
    const to = yield* abs(toRel);
    yield* ensureParent(to, toRel);
    yield* fs.copyFile(source, to).pipe(Effect.mapError(fileFailure(`copy ${source} to`, toRel)));
  });

  const statFull = (full: string, relPath: string) =>
    fs.stat(full).pipe(
      Effect.mapError(fileFailure("read", relPath)),
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

    if (!(yield* fs.exists(full).pipe(Effect.mapError(fileFailure("check", relPath))))) return [];
    const names = yield* fs.readDirectory(full).pipe(Effect.mapError(fileFailure("list", relPath)));

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
      .pipe(Effect.mapError(fileFailure("remove", relPath)));
  });

  const peek = Effect.fn("Workspace.peek")(function* (full: string) {
    const info = yield* fs.stat(full).pipe(Effect.mapError(fileFailure("read", full)));

    if (info.type !== "Directory") {
      const file: Peek = { dir: false };

      return file;
    }

    const names = yield* fs.readDirectory(full).pipe(Effect.mapError(fileFailure("list", full)));

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
        Effect.mapError(fileFailure("read", full)),
        Effect.withSpan("Workspace.peekText"),
      );

  const peekBytes = (full: string, maxBytes: number) =>
    fs
      .stream(full, { bytesToRead: maxBytes })
      .pipe(
        Stream.mkUint8Array,
        Effect.mapError(fileFailure("read", full)),
        Effect.withSpan("Workspace.peekBytes"),
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
    peekBytes,
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
