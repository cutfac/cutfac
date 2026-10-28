import { Effect, Option, Ref, Schema } from "effect";

import type { Ask } from "./approval.ts";
import { appStoreFile, peekAppStore, updateAppStore } from "./appStore.ts";
import { sha256 } from "./crypto.ts";
import { Conflict } from "./errors.ts";
import { byName, canonicalJson, isEmptyJson, isJsonObject } from "./json.ts";
import { readOptionalText } from "./library.ts";
import type { AgentName } from "./schema.ts";
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

/** The app's record of the workspaces the user trusts, by root, in its own folder. */
const STORE_FILE = "workspaces.json";

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

const decodeRecord = Schema.decodeUnknownOption(TrustRecord);

/** The settings in `text`, the settings file `file`, that Claude Code acts on by itself. */
export function trustItems(file: string, text: string): ReadonlyArray<TrustItem> {
  if (text.trim() === "") return [];
  const settings = decodeSettings(text);

  if (Option.isNone(settings)) return [{ file, value: text }];

  return Object.entries(settings.value).flatMap(([key, value]): ReadonlyArray<TrustItem> => {
    if (PLAIN_SETTINGS.has(key) || isEmptyJson(value)) return [];

    if (key !== "permissions" || !isJsonObject(value)) return [{ file, key, value }];

    return Object.entries(value)
      .filter(([name, rule]) => !PLAIN_PERMISSIONS.has(name) && !isEmptyJson(rule))
      .map(([name, rule]) => ({ file, key: `permissions.${name}`, value: rule }));
  });
}

/** A name for exactly these settings, whatever order their files list them in. */
export const fingerprintOf = (items: ReadonlyArray<TrustItem>) =>
  sha256(
    JSON.stringify(
      items
        .map((item) => [item.file, item.key ?? "", canonicalJson(item.value)] as const)
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

const NO_RECORD: TrustRecord = {};

const recordIn = (store: Schema.JsonObject, root: string) =>
  Option.getOrElse(decodeRecord(store[root]), () => NO_RECORD);

/** This workspace's record; none when there is no store, or it can't be read. */
const ownRecord = Effect.gen(function* () {
  const ws = yield* Workspace;

  return recordIn(yield* peekAppStore(STORE_FILE), ws.root);
});

/** Change this workspace's record, keeping every other workspace's as it was. */
const updateRecord = Effect.fnUntraced(function* (change: (record: TrustRecord) => TrustRecord) {
  const ws = yield* Workspace;

  yield* updateAppStore(STORE_FILE, "the trust", (store) => ({
    ...store,
    [ws.root]: change(recordIn(store, ws.root)),
  }));
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

/**
 * Fail when `agent` can't run in this workspace until the user trusts it; with the trust Claude
 * runs on, or none for Codex.
 */
export const requireTrust = Effect.fn("workspaceTrust.require")(function* (agent: AgentName) {
  if (agent !== "claude") return undefined;
  const status = yield* trustStatus();

  if (status.needed) return yield* new Conflict({ message: trustMessage(status.items) });

  return status;
});

const itemKey = (item: TrustItem) => `${item.file}\0${item.key ?? ""}`;

const sameJson = (a: Schema.Json, b: Schema.Json) =>
  JSON.stringify(canonicalJson(a)) === JSON.stringify(canonicalJson(b));

const decodeRules = Schema.decodeUnknownOption(Schema.Array(Schema.String));

/**
 * Whether all that changed from `before` to `after` is allow rules in `approved`: an item is as it
 * was, or an allow list whose new rules are all approved.
 */
function onlyApproved(
  before: ReadonlyArray<TrustItem>,
  after: ReadonlyArray<TrustItem>,
  approved: ReadonlySet<string>,
) {
  const was = new Map(before.map((item) => [itemKey(item), item.value]));

  return after.every((item) => {
    const earlier = was.get(itemKey(item));

    if (earlier !== undefined && sameJson(earlier, item.value)) return true;

    if (item.key !== "permissions.allow") return false;
    const rules = decodeRules(item.value);
    const kept = new Set(Option.getOrElse(decodeRules(earlier), () => []));

    return (
      Option.isSome(rules) && rules.value.every((rule) => kept.has(rule) || approved.has(rule))
    );
  });
}

/**
 * Keep trusting the workspace after a run that started trusted, `before`, when all it changed in
 * the settings are the rules the user kept with Always allow, `approved`.
 */
const keepTrust = Effect.fnUntraced(function* (
  before: TrustStatus,
  approved: ReadonlyArray<string>,
) {
  if (approved.length === 0) return;
  const after = yield* trustStatus();

  if (!after.needed || !onlyApproved(before.items, after.items, new Set(approved))) return;
  yield* updateRecord((record) => ({ ...record, settings: after.fingerprint }));
});

/**
 * Run `use` with `ask`, keeping the workspace trusted for the rules the user keeps with Always
 * allow on the way, which Claude Code writes to the settings trust names. `trust` is the trust the
 * run started on; none for an agent that needs none.
 */
export const askingTrusted = <A, E, R>(
  trust: TrustStatus | undefined,
  ask: Ask,
  use: (ask: Ask) => Effect.Effect<A, E, R>,
) =>
  Effect.gen(function* () {
    if (trust === undefined) return yield* use(ask);
    const approved = yield* Ref.make<ReadonlyArray<string>>([]);

    const noting: Ask = (approval) =>
      Effect.tap(ask(approval), (answer) =>
        answer === "always"
          ? Ref.update(approved, (rules) => [...rules, ...approval.rules])
          : Effect.void,
      );

    const keep = Effect.flatMap(Ref.get(approved), (rules) => keepTrust(trust, rules)).pipe(
      Effect.ignore({ log: true }),
    );

    return yield* use(noting).pipe(Effect.ensuring(keep));
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
  if (Option.isNone(yield* appStoreFile(STORE_FILE)) || (yield* workspaceItems).length > 0) return;

  yield* updateRecord((record) => ({ ...record, created: true }));
});
