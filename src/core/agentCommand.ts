import { Effect, Option } from "effect";

import type { ParsedLine } from "./agentParse.ts";
import { MCP_READ_TOOLS, MCP_USER_ONLY_TOOLS, MCP_WRITE_TOOLS, claudeMcpTool } from "./agents.ts";
import { claudeMessage, parseClaudeLine } from "./claudeStream.ts";
import { codexTurn } from "./codexAppServer.ts";
import { CODEX_INITIALIZE, type CodexPermissions } from "./codexProtocol.ts";
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
  /** Claude's permission flags for how much the run may do; Claude's own settings when left out. */
  readonly permissions?: ReadonlyArray<string> | undefined;
  /** How much a Codex run may do; editing in the workspace and asking for more when left out. */
  readonly codexPermissions?: CodexPermissions | undefined;
  /** Claude's `--mcp-config` as a JSON string, the only MCP servers the run loads. */
  readonly mcpConfig?: string | undefined;
  /** Codex config entries that point its MCP server at this workspace. */
  readonly codexConfig?: ReadonlyArray<string> | undefined;
  /** Added to the environment the agent inherits, such as the secrets `mcpConfig` names. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  /** Pictures the agent should see: the marked frame and any the user attached. */
  readonly images?: ReadonlyArray<string> | undefined;
  /** Hosts of the web pages the user pointed the item at, which Codex then searches the web for. */
  readonly hosts?: ReadonlyArray<string> | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

export interface AgentInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The first input, so the prompt never collides with option parsing or argv limits. */
  readonly stdin: string;
  /**
   * Whether stdin stays open for what the agent asks and the answers to it, until its result:
   * Claude's stream-json control requests, or Codex's app-server connection.
   */
  readonly attended?: true;
  /** Reads one line the agent writes; paths under `root` show relative to it. */
  readonly parse: (line: string, root: string | undefined) => ParsedLine;
  /** Added to the environment the agent inherits. */
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Whether `id` is a session the agent made: Claude Code and Codex both name theirs with a UUID.
 * Anything else, passed back to resume, could be read as one of the CLI's own flags.
 */
export const isSessionId = (id: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

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
    parse: parseClaudeLine,
  };
}

/**
 * `claudeCommand` that asks before a tool its settings don't allow, as it would in a terminal: the
 * requests come on stdout and the answers go back on stdin.
 */
export function attendedClaude(
  bin: string,
  prompt: string,
  flags: ReadonlyArray<string>,
  session: SessionArgs,
): AgentInvocation {
  const asking = ["--input-format", "stream-json", "--permission-prompt-tool", "stdio", ...flags];

  return {
    ...claudeCommand(bin, prompt, asking, session),
    stdin: claudeMessage(prompt),
    attended: true,
  };
}

/** Where the agent's CLI is, or a failure that says it is not installed. */
export const agentBin = (agent: AgentName) =>
  Effect.flatMap(
    which(agent),
    Option.match({
      onNone: () => Effect.fail(new CommandFailed({ message: `${agent} CLI not found on PATH` })),
      onSome: Effect.succeed,
    }),
  );

const USER_ONLY: ReadonlySet<string> = new Set(MCP_USER_ONLY_TOOLS);

/** Cutfac's own tools, which a run uses without asking, but for those the user has to agree to. */
const CLAUDE_CUTFAC_TOOLS = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS]
  .flatMap((tool) => (USER_ONLY.has(tool) ? [] : [claudeMcpTool(tool)]))
  .join(",");

/** `[flag, value]` when there is a value, so a setting left out keeps the CLI's default. */
const flag = (name: string, value: string | undefined) =>
  value === undefined ? [] : [name, value];

/** What a Codex run may do when the caller doesn't say: edit in the workspace, and ask for more. */
const CODEX_EDIT: CodexPermissions = {
  sandbox: "workspace-write",
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
};

/** Codex's own tool for asking the user questions, which the board answers for edit runs. */
const CODEX_ASKS = "features.default_mode_request_user_input=true";

/**
 * `codex app-server` over stdio for one turn: the connection opens with the first line, and the
 * thread, the turn and the answers to what Codex asks follow as it replies.
 */
export function codexInvocation(options: InvocationOptions): AgentInvocation {
  const { bin, codexConfig = [], hosts = [], images = [] } = options;
  const search = hosts.length === 0 ? [] : ['web_search="live"'];

  return {
    command: bin,
    args: ["app-server", ...[...codexConfig, ...search].flatMap((entry) => ["-c", entry])],
    stdin: CODEX_INITIALIZE,
    attended: true,
    parse: codexTurn({
      prompt: options.prompt,
      sessionId: options.sessionId,
      images,
      model: options.model,
      effort: options.effort,
      permissions: options.codexPermissions ?? CODEX_EDIT,
    }),
  };
}

/**
 * The command line for one edit request, resuming the item's session when it has one. Both agents
 * ask the board what they would ask the user in a terminal.
 */
export function agentInvocation(agent: AgentName, options: InvocationOptions): AgentInvocation {
  const { bin, prompt, mcpConfig, env, model, effort, permissions = [] } = options;

  const invocation =
    agent === "claude"
      ? attendedClaude(
          bin,
          prompt,
          [
            ...permissions,
            "--allowedTools",
            CLAUDE_CUTFAC_TOOLS,
            // Only the servers in `mcpConfig`, none the user or the workspace set up elsewhere.
            "--strict-mcp-config",
            ...flag("--mcp-config", mcpConfig),
            ...flag("--model", model),
            ...flag("--effort", effort),
          ],
          options,
        )
      : codexInvocation({ ...options, codexConfig: [...(options.codexConfig ?? []), CODEX_ASKS] });

  return env === undefined ? invocation : { ...invocation, env };
}
