import { Effect, Option, Path, Predicate, Schema } from "effect";

import { AppData, readAppFile, writeAppFile } from "./appData.ts";
import { Conflict, InvalidRequest, WorkspaceError } from "./errors.ts";
import { readOptionalText } from "./library.ts";
import type { AgentName } from "./schema.ts";
import { sha256 } from "./skill.ts";
import { Workspace } from "./workspace.ts";

/** Claude Code's settings in a workspace, which it loads on every run there. */
export const SETTINGS_FILES = [".claude/settings.json", ".claude/settings.local.json"] as const;

/**
 * Settings that only shape how Claude Code answers, or pick among `.mcp.json`'s servers, which a
 * run here never loads. Anything else in the files may run a command, or allow one, on its own.
 */
const PLAIN_SETTINGS = new Set([
  "$schema",
  "model",
  "outputStyle",
  "language",
  "alwaysThinkingEnabled",
  "includeCoAuthoredBy",
  "attribution",
  "cleanupPeriodDays",
  "spinnerTipsEnabled",
  "enableAllProjectMcpServers",
  "enabledMcpjsonServers",
  "disabledMcpjsonServers",
]);

/** Permission settings that only hold tools back. */
const PLAIN_PERMISSIONS = new Set(["deny", "ask", "disableBypassPermissionsMode"]);

/** The app's record of the workspaces the user trusts, in its own folder. */
const STORE_FILE = "workspaces.json";

/** Far more than a record per workspace needs; past this, the file isn't the app's. */
const STORE_BYTES = 4 * 1024 * 1024;

/**
 * A setting in the workspace that Claude Code would act on without asking, such as a hook or an
 * allowed command. With no key, the whole file, which is not JSON Claude Code's way of reading
 * settings is known to take.
 */
export interface TrustItem {
  readonly file: string;
  readonly key?: string;
  readonly value: Schema.Json;
}

/** Whether Claude may run in the workspace, and the settings the user trusts it with. */
export interface TrustStatus {
  /** Claude waits until the user trusts the workspace. */
  readonly needed: boolean;
  readonly items: ReadonlyArray<TrustItem>;
  /** Names exactly these settings, so trusting them doesn't trust ones added since. */
  readonly fingerprint: string;
}

/**
 * The user trusts a workspace Cutfac made for as long as it is there, as Claude Code and Codex
 * trust a folder; and a folder that was there already for the settings they looked over.
 */
const TrustRecord = Schema.Struct({
  created: Schema.optionalKey(Schema.Boolean),
  settings: Schema.optionalKey(Schema.String),
});

type TrustRecord = typeof TrustRecord.Type;

const decodeSettings = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.JsonObject));

/** Every workspace's record, by its root; others' are kept as they are. */
const TrustStore = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json), { space: 2 });

const decodeStore = Schema.decodeUnknownOption(TrustStore);

const decodeRecord = Schema.decodeUnknownOption(TrustRecord);

const isObject = (value: Schema.Json): value is Schema.JsonObject => Predicate.isObject(value);

/** Null, `[]` and `{}`, which turn nothing on. */
const isEmpty = (value: Schema.Json) =>
  value === null ||
  (Array.isArray(value) && value.length === 0) ||
  (isObject(value) && Object.keys(value).length === 0);

/** The settings in `text`, the settings file `file`, that Claude Code acts on by itself. */
export function trustItems(file: string, text: string): ReadonlyArray<TrustItem> {
  if (text.trim() === "") return [];
  const settings = decodeSettings(text);

  if (Option.isNone(settings)) return [{ file, value: text }];

  return Object.entries(settings.value).flatMap(([key, value]): ReadonlyArray<TrustItem> => {
    if (PLAIN_SETTINGS.has(key) || isEmpty(value)) return [];

    if (key !== "permissions" || !isObject(value)) return [{ file, key, value }];

    return Object.entries(value)
      .filter(([name, rule]) => !PLAIN_PERMISSIONS.has(name) && !isEmpty(rule))
      .map(([name, rule]) => ({ file, key: `permissions.${name}`, value: rule }));
  });
}

/** Code-unit order, the same on every machine, unlike a locale's. */
const byName =
  <A>(name: (a: A) => string) =>
  (a: A, b: A) => {
    const [x, y] = [name(a), name(b)];

    return x < y ? -1 : x > y ? 1 : 0;
  };

/** `value` with every object's keys in order, so the same settings always read the same. */
const canonical = (value: Schema.Json): Schema.Json => {
  if (Array.isArray(value)) return value.map(canonical);

  if (!isObject(value)) return value;

  return Object.fromEntries(
    Object.entries(value)
      .toSorted(byName(([key]) => key))
      .map(([key, entry]) => [key, canonical(entry)]),
  );
};

/** A name for exactly these settings, whatever order their files list them in. */
export const fingerprintOf = (items: ReadonlyArray<TrustItem>) =>
  sha256(
    JSON.stringify(
      items
        .map((item) => [item.file, item.key ?? "", canonical(item.value)] as const)
        .toSorted(byName(([file, key]) => `${file}\0${key}`)),
    ),
  );

/** Which settings in `items` there are, file by file, as a message names them. */
export function describeItems(items: ReadonlyArray<TrustItem>): string {
  return SETTINGS_FILES.flatMap((file) => {
    const keys = items.flatMap((item) => (item.file === file ? [item.key ?? "all of it"] : []));

    return keys.length === 0 ? [] : [`${keys.join(", ")} in ${file}`];
  }).join("; ");
}

/** What the user does before Claude runs in a workspace whose settings act on their own. */
export const trustMessage = (items: ReadonlyArray<TrustItem>) =>
  `This workspace's Claude Code settings run or allow commands on their own (${describeItems(items)}). ` +
  "Cutfac starts Claude here once the user looks them over and trusts the workspace in the board's Setup.";

/** The settings in the workspace's Claude Code settings files that act on their own. */
const workspaceItems = Effect.map(
  Effect.forEach(SETTINGS_FILES, (file) =>
    Effect.map(readOptionalText(file), (text) => trustItems(file, text ?? "")),
  ),
  (files) => files.flat(),
);

/** The app's trust record file, or why there is none to keep trust in. */
const storeFile = Effect.gen(function* () {
  const dir = yield* AppData;
  const path = yield* Path.Path;

  return Option.map(dir, (found) => path.join(found, STORE_FILE));
});

/** Every workspace's record as the file has it; none while there is no file. */
const readStore = Effect.fnUntraced(function* (file: string) {
  const text = yield* readAppFile(file, STORE_BYTES);

  if (Option.isNone(text)) return {} satisfies Schema.JsonObject;
  const store = decodeStore(text.value);

  if (Option.isNone(store)) {
    return yield* new WorkspaceError({ message: `${file} is not a list Cutfac can read` });
  }

  return store.value;
});

const NO_RECORD: TrustRecord = {};

const recordIn = (store: Schema.JsonObject, root: string) =>
  Option.getOrElse(decodeRecord(store[root]), () => NO_RECORD);

/** This workspace's record; none when there is no store, or it can't be read. */
const ownRecord = Effect.gen(function* () {
  const ws = yield* Workspace;
  const file = yield* storeFile;

  if (Option.isNone(file)) return NO_RECORD;

  return yield* readStore(file.value).pipe(
    Effect.map((store) => recordIn(store, ws.root)),
    Effect.tapError((error) => Effect.logWarning("Could not read the trusted workspaces", error)),
    Effect.orElseSucceed(() => NO_RECORD),
  );
});

/** Change this workspace's record, one change at a time. */
const updateRecord = Effect.fnUntraced(function* (change: (record: TrustRecord) => TrustRecord) {
  const ws = yield* Workspace;
  const file = yield* storeFile;

  if (Option.isNone(file)) {
    return yield* new InvalidRequest({
      message: "There is no app data folder to keep the trust in",
    });
  }

  yield* ws.exclusive(
    "app:workspaces",
    Effect.gen(function* () {
      const store = yield* readStore(file.value);
      const record = change(recordIn(store, ws.root));

      const text = yield* Schema.encodeEffect(TrustStore)({ ...store, [ws.root]: record }).pipe(
        Effect.mapError(
          (error) => new WorkspaceError({ message: `${file.value}: ${error.message}` }),
        ),
      );

      yield* writeAppFile(file.value, `${text}\n`);
    }),
  );
});

/** Whether Claude may run in this workspace, with the settings that decide it. */
export const trustStatus = Effect.fn("workspaceTrust.status")(function* () {
  const items = yield* workspaceItems;
  const fingerprint = yield* fingerprintOf(items);

  if (items.length === 0) return { needed: false, items, fingerprint } satisfies TrustStatus;
  const record = yield* ownRecord;
  const trusted = record.created === true || record.settings === fingerprint;

  return { needed: !trusted, items, fingerprint } satisfies TrustStatus;
});

/** Why `agent` can't run in this workspace yet, if it can't. */
export const trustProblem = Effect.fn("workspaceTrust.problem")(function* (agent: AgentName) {
  // Codex leaves a folder's own settings off by itself until the user trusts it in Codex.
  if (agent !== "claude") return undefined;
  const status = yield* trustStatus();

  return status.needed ? trustMessage(status.items) : undefined;
});

/** The trust the workspace waits for, as workspace_overview tells the agent. */
export const trustNotices = Effect.fn("workspaceTrust.notices")(function* () {
  const problem = yield* trustProblem("claude");

  return problem === undefined ? [] : [problem];
});

/** Fail when `agent` can't run in this workspace until the user trusts it. */
export const requireTrust = Effect.fn("workspaceTrust.require")(function* (agent: AgentName) {
  const problem = yield* trustProblem(agent);

  if (problem !== undefined) return yield* new Conflict({ message: problem });
});

/**
 * Trust the workspace's settings as the user saw them, named by `fingerprint`. Settings that
 * changed since are not trusted; the user looks them over again.
 */
export const trustWorkspace = Effect.fn("workspaceTrust.trust")(function* (fingerprint: string) {
  const status = yield* trustStatus();

  if (status.fingerprint !== fingerprint) {
    return yield* new Conflict({
      message: "The workspace's Claude Code settings changed; look them over again",
    });
  }

  if (!status.needed) return status;
  yield* updateRecord((record) => ({ ...record, settings: fingerprint }));

  return { ...status, needed: false } satisfies TrustStatus;
});

/**
 * Trust a workspace Cutfac just made, unless the folder already held settings that act on their
 * own, which the user looks over first. Does nothing where there is no app data folder.
 */
export const trustCreated = Effect.fn("workspaceTrust.trustCreated")(function* () {
  if (Option.isNone(yield* storeFile) || (yield* workspaceItems).length > 0) return;

  yield* updateRecord((record) => ({ ...record, created: true }));
});
