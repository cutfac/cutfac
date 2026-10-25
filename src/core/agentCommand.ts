import { Effect, Option, Schema } from "effect";

import type { ToolRequest } from "./agentParse.ts";
import { codexPermissionConfig } from "./agentPermissions.ts";
import { MCP_READ_TOOLS, MCP_USER_ONLY_TOOLS, MCP_WRITE_TOOLS, claudeMcpTool } from "./agents.ts";
import type { ApprovalAnswer } from "./approval.ts";
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
  /**
   * Claude's permission flags, or Codex's config entries, for how much the run may do: Claude's own
   * settings, or Codex editing in the workspace, when left out.
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
  /** Hosts of the web pages the user pointed the item at, which Codex then searches the web for. */
  readonly hosts?: ReadonlyArray<string> | undefined;
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

export interface AgentInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The prompt goes in on stdin so it never collides with option parsing or argv limits. */
  readonly stdin: string;
  /**
   * Whether the agent asks before a tool its settings don't allow and waits for the answer: Claude
   * reads stream-json on stdin, asks on stdout, and takes answers on stdin, open until its result.
   */
  readonly attended?: true;
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
  };
}

/** Claude's answer to a request, as `--permission-prompt-tool stdio` reads it. */
type Decision =
  | {
      readonly behavior: "allow";
      readonly updatedInput: Schema.JsonObject;
      readonly updatedPermissions?: ReadonlyArray<Schema.Json>;
      readonly toolUseID: string | undefined;
      readonly decisionClassification: "user_temporary" | "user_permanent";
    }
  | {
      readonly behavior: "deny";
      readonly message: string;
      readonly toolUseID: string | undefined;
      readonly decisionClassification: "user_reject";
    };

/** A line of Claude's stream-json input: the user's message, or the answer to a request. */
type ClaudeInput =
  | { readonly type: "user"; readonly message: { readonly role: "user"; readonly content: string } }
  | {
      readonly type: "control_response";
      readonly response:
        | { readonly subtype: "success"; readonly request_id: string; readonly response: Decision }
        | { readonly subtype: "error"; readonly request_id: string; readonly error: string };
    };

const claudeLine = (input: ClaudeInput) => `${JSON.stringify(input)}\n`;

/** The user's message `prompt`, as Claude reads it from stream-json. */
export const claudeMessage = (prompt: string) =>
  claudeLine({ type: "user", message: { role: "user", content: prompt } });

/** What Claude Code itself tells the model when the user turns a tool down. */
const REJECTED =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was " +
  "a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for " +
  "the user to tell you how to proceed.";

function claudeDecision(request: ToolRequest, answer: ApprovalAnswer, message: string): Decision {
  const toolUseID = request.toolUseId;

  if (answer === "deny") {
    return { behavior: "deny", message, toolUseID, decisionClassification: "user_reject" };
  }

  const once = { behavior: "allow", updatedInput: request.input, toolUseID } as const;

  if (answer === "allow") return { ...once, decisionClassification: "user_temporary" };

  return {
    ...once,
    updatedPermissions: request.suggestions,
    decisionClassification: "user_permanent",
  };
}

/**
 * The answer to `request`, as Claude Code's own prompt would give it: the input as asked, and for
 * Always allow the rules it offered, which it then keeps where it said.
 */
export const claudeAnswer = (request: ToolRequest, answer: ApprovalAnswer, message = REJECTED) =>
  claudeLine({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: request.approval.id,
      response: claudeDecision(request, answer, message),
    },
  });

/** The answer to a request of a kind the board doesn't take, so Claude goes on without it. */
export const claudeRefusal = (id: string, error: string) =>
  claudeLine({ type: "control_response", response: { subtype: "error", request_id: id, error } });

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

const USER_ONLY: ReadonlySet<string> = new Set(MCP_USER_ONLY_TOOLS);

/** Cutfac's own tools, which a run uses without asking, but for those the user has to agree to. */
const CLAUDE_CUTFAC_TOOLS = [...MCP_READ_TOOLS, ...MCP_WRITE_TOOLS]
  .flatMap((tool) => (USER_ONLY.has(tool) ? [] : [claudeMcpTool(tool)]))
  .join(",");

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

/**
 * The command line for one edit request, resuming the item's session when it has one. Claude asks
 * the board as it would ask in a terminal; Codex can't yet, so it runs without asking.
 */
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
    permissions = agent === "claude" ? [] : codexPermissionConfig("edit", {}),
  } = options;

  const search = hosts.length === 0 ? [] : ['web_search="live"'];
  // The schema keeps an effort to lowercase letters, so it is safe inside the TOML string.
  const reasoning = effort === undefined ? [] : [`model_reasoning_effort="${effort}"`];

  const flags =
    agent === "claude"
      ? [
          ...permissions,
          "--allowedTools",
          CLAUDE_CUTFAC_TOOLS,
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

  const invocation =
    agent === "claude"
      ? attendedClaude(bin, prompt, flags, options)
      : codexCommand(bin, prompt, flags, options.sessionId);

  return env === undefined ? invocation : { ...invocation, env };
}
