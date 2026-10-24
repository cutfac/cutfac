import { Effect, Option } from "effect";

import { claudePermissionFlags, codexPermissionConfig } from "./agentPermissions.ts";
import { MCP_USER_ONLY_TOOLS, claudeMcpTool } from "./agents.ts";
import { CommandFailed } from "./errors.ts";
import { which } from "./process.ts";
import type { AgentName } from "./schema.ts";

/** The session to resume, or the id to give a new one (Codex picks its own). */
export interface SessionArgs {
  readonly sessionId: string | undefined;
  readonly newSessionId: string;
}

export interface InvocationOptions extends SessionArgs {
  readonly bin: string;
  readonly prompt: string;
  readonly allowedTools: ReadonlyArray<string>;
  /**
   * Claude's permission flags, or Codex's config entries, for how much the run may do; editing in
   * the workspace when left out.
   */
  readonly permissions?: ReadonlyArray<string> | undefined;
  /** Claude's `--mcp-config` as a JSON string, the only MCP servers the run loads. */
  readonly mcpConfig?: string | undefined;
  /** Codex config entries that point its MCP server at this workspace. */
  readonly codexServer?: ReadonlyArray<string> | undefined;
  /** Added to the environment the agent inherits, such as the secrets `mcpConfig` names. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** Pictures the agent should see: the marked frame and any the user attached. */
  readonly images?: ReadonlyArray<string> | undefined;
  /** Hosts of the web pages the user pointed the item at, which the agent may read. */
  readonly hosts?: ReadonlyArray<string> | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

export interface AgentInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The prompt goes in on stdin so it never collides with option parsing or argv limits. */
  readonly stdin: string;
  /** Added to the environment the agent inherits. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Whether `id` is a session the agent made: Claude Code and Codex both name theirs with a UUID.
 * Anything else, passed back to resume, could be read as one of the CLI's own flags.
 */
export const isSessionId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

/**
 * Whether `rule` is one Claude Code permission rule, a tool name with an optional specifier, as in
 * `Bash(uv:*)`. Rules go to Claude Code joined with commas, and a comma or a closing parenthesis
 * where it does not belong would add rules nobody asked for.
 */
export const isToolRule = (rule: string) => /^[\w-]+(?:\([^(),\p{Cc}]*\))?$/u.test(rule);

/** `claude -p` streaming JSON, with `flags` deciding what it may do. */
export function claudeCommand(
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  session: SessionArgs,
): AgentInvocation {
  return {
    command: bin,
    args: [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      ...flags,
      ...(session.sessionId === undefined
        ? ["--session-id", session.newSessionId]
        : ["--resume", session.sessionId]),
    ],
    stdin: prompt,
  };
}

/** `codex exec --json`, with `flags` deciding what it may do. */
export function codexCommand(
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  sessionId: string | undefined,
): AgentInvocation {
  const shared = ["--json", "--skip-git-repo-check", ...flags];

  return {
    command: bin,
    args:
      sessionId === undefined
        ? ["exec", ...shared, "-"]
        : ["exec", "resume", ...shared, sessionId, "-"],
    stdin: prompt,
  };
}

/**
 * Codex config overrides. `codex exec resume` takes no --sandbox flag, so policies always go
 * through config, which both forms accept.
 */
export const codexConfig = (entries: ReadonlyArray<string>) =>
  entries.flatMap((entry) => ["-c", entry]);

/** The agent's headless command line for `prompt`, with `flags` deciding what it may do. */
export const agentCommand = (
  agent: AgentName,
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  session: SessionArgs,
): AgentInvocation =>
  agent === "claude"
    ? claudeCommand(bin, prompt, flags, session)
    : codexCommand(bin, prompt, flags, session.sessionId);

/** Where the agent's CLI is, or a failure that says it is not installed. */
export const agentBin = (agent: AgentName) =>
  Effect.flatMap(
    which(agent),
    Option.match({
      onNone: () => Effect.fail(new CommandFailed({ message: `${agent} CLI not found on PATH` })),
      onSome: Effect.succeed,
    }),
  );

/** `[flag, value]` when there is a value, so a setting left out keeps the CLI's default. */
const flag = (name: string, value: string | undefined) =>
  value === undefined ? [] : [name, value];

/**
 * Codex's flags for pictures it should see. `--image` takes several values and would swallow the
 * `-` that reads the prompt from stdin, so each goes in its own `=` form. It also splits on
 * commas, so a path with one stays listed in the prompt only.
 */
export const codexImageFlags = (images: ReadonlyArray<string>) =>
  images.flatMap((image) => (image.includes(",") ? [] : [`--image=${image}`]));

/** The headless command line for one edit request, resuming the item's session when it has one. */
export function agentInvocation(agent: AgentName, options: InvocationOptions): AgentInvocation {
  const {
    bin,
    prompt,
    mcpConfig,
    codexServer = [],
    env,
    images = [],
    hosts = [],
    model,
    effort,
    permissions = agent === "claude"
      ? claudePermissionFlags("edit", {})
      : codexPermissionConfig("edit", {}),
  } = options;

  const fetch = hosts.map((host) => `WebFetch(domain:${host})`);
  const search = hosts.length === 0 ? [] : ['web_search="live"'];
  // The schema keeps an effort to lowercase letters, so it is safe inside the TOML string.
  const reasoning = effort === undefined ? [] : [`model_reasoning_effort="${effort}"`];

  const flags =
    agent === "claude"
      ? [
          ...permissions,
          "--allowedTools",
          [...options.allowedTools, ...fetch].filter(isToolRule).join(","),
          "--disallowedTools",
          MCP_USER_ONLY_TOOLS.map(claudeMcpTool).join(","),
          // Only the servers in `mcpConfig`, none the user or the workspace set up elsewhere.
          "--strict-mcp-config",
          ...flag("--mcp-config", mcpConfig),
          ...flag("--model", model),
          ...flag("--effort", effort),
        ]
      : [
          ...codexConfig([...permissions, ...search, ...reasoning, ...codexServer]),
          ...flag("-m", model),
          ...codexImageFlags(images),
        ];

  const invocation = agentCommand(agent, bin, prompt, flags, options);

  return env === undefined ? invocation : { ...invocation, env };
}
