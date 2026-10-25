import { Effect, Option, Path, Schema } from "effect";

import { claudeSettingsFiles, codexHome } from "./agents.ts";
import { peekAppStore, updateAppStore } from "./appStore.ts";
import type { CodexPermissions } from "./codexProtocol.ts";
import { isJsonObject, setAt } from "./json.ts";
import { peekConfig } from "./mcpServers.ts";
import { AGENTS, AgentName } from "./schema.ts";

/**
 * How much a run from the board may do without asking, as the user chose for each agent: as their
 * own settings say, or one of Cutfac's three.
 */
export const PermissionMode = Schema.Literals(["follow", "edit", "auto", "full"]);

export type PermissionMode = typeof PermissionMode.Type;

/**
 * What a run may do in the end: ask the board before it acts, edit in the workspace, more as a
 * reviewer agrees, anything, edit but skip what it would have to ask about, or less.
 */
export type Access = "asks" | "edit" | "auto" | "full" | "unasked" | "limited";

/** The user's own permission setting for Claude Code: its `permissions.defaultMode`. */
export interface ClaudePermissionSettings {
  readonly defaultMode?: string | undefined;
}

/** The user's own permission settings for Codex, as its `config.toml` and profile set them. */
export interface CodexPermissionSettings {
  readonly sandbox?: string | undefined;
  readonly approval?: string | undefined;
  readonly reviewer?: string | undefined;
}

/** How an agent's runs may act, as the board shows it. */
export interface PermissionView {
  readonly agent: AgentName;
  readonly mode: PermissionMode;
  /** What following the user's own settings comes to. */
  readonly follows: Access;
  /** The setting that decides it, as the user wrote it; none when they set none. */
  readonly setting?: string | undefined;
}

/** The reviewers that answer Codex's requests for more access without the user. */
const CODEX_REVIEWERS = new Set(["auto_review", "guardian_subagent"]);

/**
 * Claude Code's flags for `mode`. Following the user's settings leaves their mode to Claude, which
 * asks the board whatever it would ask them in a terminal.
 */
export function claudePermissionFlags(mode: PermissionMode): ReadonlyArray<string> {
  switch (mode) {
    case "follow":
      return [];
    case "edit":
      return ["--permission-mode", "acceptEdits"];
    case "auto":
      return ["--permission-mode", "auto"];
    case "full":
      return ["--permission-mode", "bypassPermissions"];
  }
}

/**
 * How a Codex run may act in `mode`. Following the user's settings leaves theirs to Codex, with the
 * workspace writable where they set no sandbox; what Codex asks then comes to the board.
 */
export function codexPermissions(
  mode: PermissionMode,
  user: CodexPermissionSettings,
): CodexPermissions {
  switch (mode) {
    case "follow":
      return user.sandbox === undefined ? { sandbox: "workspace-write" } : {};
    case "edit":
      return {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
      };
    case "auto":
      return {
        sandbox: "workspace-write",
        approvalPolicy: "on-request",
        approvalsReviewer: "auto_review",
      };
    case "full":
      return { sandbox: "danger-full-access", approvalPolicy: "never" };
  }
}

/** Whether Codex's requests for more access go to a reviewer rather than the user. */
const codexReviewed = (user: CodexPermissionSettings) =>
  user.reviewer !== undefined && CODEX_REVIEWERS.has(user.reviewer);

/** What following the user's Claude Code settings comes to. */
export function claudeAccess(user: ClaudePermissionSettings): Access {
  switch (user.defaultMode) {
    case undefined:
    case "default":
      return "asks";
    case "acceptEdits":
      return "edit";
    case "auto":
      return "auto";
    case "bypassPermissions":
      return "full";
    default:
      return "limited";
  }
}

/**
 * What following the user's Codex settings comes to. Never asking, a run skips what would need
 * the user; asking before every command, or in a read-only sandbox, it asks before it edits.
 */
export function codexAccess(user: CodexPermissionSettings): Access {
  const sandbox = user.sandbox ?? "workspace-write";

  if (sandbox === "danger-full-access") return "full";
  const writes = sandbox === "workspace-write";

  if (user.approval === "never") return writes ? "unasked" : "limited";

  if (codexReviewed(user)) return "auto";

  return user.approval === "untrusted" || !writes ? "asks" : "edit";
}

const ClaudeSettings = Schema.fromJsonString(
  Schema.Struct({
    permissions: Schema.optional(Schema.Struct({ defaultMode: Schema.optional(Schema.String) })),
  }),
);

const decodeClaudeSettings = Schema.decodeUnknownOption(ClaudeSettings);

/** The user's Claude Code mode: from the first of its settings files that sets one. */
const claudeSettings = Effect.gen(function* () {
  for (const file of yield* claudeSettingsFiles) {
    const mode = Option.flatMap(yield* peekConfig(file), decodeClaudeSettings).pipe(
      Option.flatMapNullishOr((settings) => settings.permissions?.defaultMode),
    );

    if (Option.isSome(mode)) return { defaultMode: mode.value } satisfies ClaudePermissionSettings;
  }

  return {} satisfies ClaudePermissionSettings;
});

/** A table of Codex's permission keys; `approval_policy` can also be a table, which isn't kept. */
const CodexPolicy = Schema.Struct({
  sandbox_mode: Schema.optional(Schema.String),
  approval_policy: Schema.optional(Schema.Unknown),
  approvals_reviewer: Schema.optional(Schema.String),
});

const CodexConfig = Schema.Struct({
  ...CodexPolicy.fields,
  profile: Schema.optional(Schema.String),
  profiles: Schema.optional(Schema.Record(Schema.String, CodexPolicy)),
});

const decodeCodexConfig = Schema.decodeUnknownOption(CodexConfig);

const decodeText = Schema.decodeUnknownOption(Schema.String);

/** The permission settings a Codex `config.toml` sets, its profile's over its own. */
export function codexPermissionSettings(toml: string): CodexPermissionSettings {
  let parsed: unknown;

  try {
    parsed = Bun.TOML.parse(toml);
  } catch {
    return {};
  }

  const config = decodeCodexConfig(parsed);

  if (Option.isNone(config)) return {};

  const { profile, profiles, ...own } = config.value;
  const chosen = profile === undefined ? undefined : profiles?.[profile];

  return {
    sandbox: chosen?.sandbox_mode ?? own.sandbox_mode,
    approval: Option.getOrUndefined(decodeText(chosen?.approval_policy ?? own.approval_policy)),
    reviewer: chosen?.approvals_reviewer ?? own.approvals_reviewer,
  };
}

/** The user's Codex settings, from its own `config.toml`. */
const codexSettings = Effect.gen(function* () {
  const path = yield* Path.Path;
  const dir = yield* codexHome;

  if (Option.isNone(dir)) return {} satisfies CodexPermissionSettings;

  const config = yield* peekConfig(path.join(dir.value, "config.toml"));

  return Option.match(config, { onNone: () => ({}), onSome: codexPermissionSettings });
});

/** The app's record of each agent the user set up, in its own folder. */
const STORE_FILE = "agents.json";

const decodeMode = Schema.decodeUnknownOption(PermissionMode);

/** The mode the user chose for `agent`; following their own settings until they choose. */
const chosenMode = Effect.fnUntraced(function* (agent: AgentName) {
  const record = (yield* peekAppStore(STORE_FILE))[agent];
  const mode = isJsonObject(record) ? decodeMode(record.permissions) : Option.none();

  return Option.getOrElse(mode, (): PermissionMode => "follow");
});

/** Claude's permission flags, or how a Codex run may act, for a run of `agent`. */
export const runPermissions = Effect.fn("agentPermissions.run")(function* (agent: AgentName) {
  const mode = yield* chosenMode(agent);

  if (agent === "claude") return { permissions: claudePermissionFlags(mode) };

  // Only following the user's settings needs them.
  return {
    codexPermissions: codexPermissions(mode, mode === "follow" ? yield* codexSettings : {}),
  };
});

const permissionView = Effect.fnUntraced(function* (agent: AgentName) {
  const mode = yield* chosenMode(agent);

  if (agent === "claude") {
    const user = yield* claudeSettings;

    return { agent, mode, follows: claudeAccess(user), setting: user.defaultMode };
  }

  const user = yield* codexSettings;

  return {
    agent,
    mode,
    follows: codexAccess(user),
    setting: [user.sandbox, user.approval, user.reviewer].filter(Boolean).join(" · ") || undefined,
  };
});

/** How each agent's runs may act, as the board shows it. */
export const agentPermissions = Effect.fn("agentPermissions.status")(function* () {
  return yield* Effect.forEach(AGENTS, permissionView);
});

/** The user's choice of how an agent's runs may act. */
export const PermissionChoice = Schema.Struct({ agent: AgentName, mode: PermissionMode });

export type PermissionChoice = typeof PermissionChoice.Type;

/** Keep the user's choice for an agent, from its next run on. */
export const setAgentPermissions = Effect.fn("agentPermissions.set")(function* ({
  agent,
  mode,
}: PermissionChoice) {
  yield* updateAppStore(STORE_FILE, "the agents' permissions", (store) =>
    setAt(store, [agent, "permissions"], mode),
  );

  return yield* permissionView(agent);
});
