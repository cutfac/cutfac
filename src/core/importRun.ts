import { Context, Effect, Option, Schema } from "effect";

import {
  type Emit,
  type RunSpec,
  type Runner,
  type Runs,
  type SessionArgs,
  type TurnResult,
  agentBin,
  agentCommand,
  codexConfig,
  converse,
  runsLayer,
} from "./agentRun.ts";
import {
  CLAUDE_MCP_TOOLS,
  MCP_READ_TOOLS,
  MCP_USER_ONLY_TOOLS,
  MCP_WRITE_TOOLS,
  type McpLaunch,
  SERVER_NAME,
  claudeMcpTool,
  codexServerKey,
  codexServerLaunch,
  codexServerName,
} from "./agents.ts";
import { CommandFailed, Conflict, NotFound } from "./errors.ts";
import {
  type NewImport,
  type RunEnd,
  type TurnInput,
  beginTurn,
  closeImport,
  createImport,
  endTurn,
  freshPrompt,
  getImport,
  saveImportSession,
  settleInstalls,
  turnMessage,
} from "./imports.ts";
import { shortId } from "./items.ts";
import { run } from "./process.ts";
import type { ImportDoc } from "./schema.ts";
import { Workspace, nowIso } from "./workspace.ts";

/**
 * Until the user presses Allow the agent may only read; after, it may install and write. The
 * phase is enforced by what the agent CLI is allowed to run, not by asking the agent.
 */
export type ImportPhase = "read" | "install";

export const importPhase = (doc: ImportDoc): ImportPhase => (doc.allowed ? "install" : "read");

export interface ImportInput {
  readonly importId: string;
  /** The turn the run answers, already recorded on the import. */
  readonly turnId: string;
  /** How the agent starts this workspace's MCP server. */
  readonly server: McpLaunch;
}

const CLAUDE_READ_TOOLS = ["Read", "Glob", "Grep", "WebFetch", "WebSearch", "Skill", "ToolSearch"];

/**
 * After Allow: fetch a skill as it is published and put it in place, nothing that runs what it
 * fetched. Writes and edits are allowed inside the workspace only; the workspace's own tools,
 * such as `npx`, are left out because they run code.
 */
const CLAUDE_INSTALL_ALLOWED = [
  ...CLAUDE_READ_TOOLS,
  "Edit(./**)",
  "Bash(git clone:*)",
  "Bash(curl:*)",
  "Bash(mkdir:*)",
  "Bash(cp:*)",
  "Bash(mv:*)",
  "Bash(ls:*)",
  "Bash(unzip:*)",
  "Bash(tar:*)",
];

/**
 * What an import may never read, in either phase: credentials in the home folder and the
 * workspace's `.env` files. Newer Claude Code also closes everything outside the workspace;
 * these rules hold on older versions too, and for shell commands in the sandbox.
 */
const CLAUDE_READ_DENIED = [
  "~/.ssh/**",
  "~/.aws/**",
  "~/.config/gh/**",
  "~/.config/gcloud/**",
  "~/.gnupg/**",
  "~/.docker/**",
  "~/.kube/**",
  "~/.netrc",
  "~/.npmrc",
  "./.env",
  "./.env.*",
  "./**/.env",
  "./**/.env.*",
].map((path) => `Read(${path})`);

/**
 * Claude Code strips credentials such as API keys from the environment of the commands it runs, so
 * a command an import page talked it into cannot send them anywhere. Codex ignores it.
 */
const IMPORT_ENV = { CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: "1" };

/** Where skills are published, besides the link itself. */
const CODE_HOSTS = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "huggingface.co",
];

/**
 * Claude's settings for an import turn. After Allow, shell commands run in Claude Code's sandbox:
 * they write only in the workspace (never its `.claude` settings, skills or hooks), reach only the
 * link's host and code hosts, and fail rather than run outside it.
 */
function claudeImportSettings(phase: ImportPhase, link: string): string {
  const permissions = { blockReadsOutsideWorkingDirectories: true };

  if (phase === "read") return JSON.stringify({ permissions });

  const host = URL.parse(link)?.hostname;

  return JSON.stringify({
    permissions,
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
      // Sandboxed commands still need an allow rule, so fetched code never runs.
      autoAllowBashIfSandboxed: false,
      network: {
        allowedDomains: host === undefined ? CODE_HOSTS : [...new Set([host, ...CODE_HOSTS])],
        // Refused rather than left waiting for an answer no one can give.
        strictAllowlist: true,
      },
    },
  });
}

/**
 * Claude's flags for an import of `link`. `--tools` is what Claude can see at all, and
 * `--allowedTools` what it may use without asking, which a headless run cannot do. Only this
 * workspace's MCP server is loaded, so the user's other servers cannot act for it.
 */
export function claudeImportFlags(phase: ImportPhase, server: McpLaunch, link: string): string[] {
  const shared = [
    "--settings",
    claudeImportSettings(phase, link),
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: { [SERVER_NAME]: server } }),
  ];

  if (phase === "read") {
    return [
      "--tools",
      CLAUDE_READ_TOOLS.join(","),
      "--allowedTools",
      [...CLAUDE_READ_TOOLS, ...MCP_READ_TOOLS.map(claudeMcpTool)].join(","),
      "--disallowedTools",
      [...CLAUDE_READ_DENIED, ...MCP_WRITE_TOOLS.map(claudeMcpTool)].join(","),
      ...shared,
    ];
  }

  return [
    "--tools",
    [...CLAUDE_READ_TOOLS, "Write", "Edit", "Bash"].join(","),
    "--allowedTools",
    [...CLAUDE_INSTALL_ALLOWED, CLAUDE_MCP_TOOLS].join(","),
    "--disallowedTools",
    [...CLAUDE_READ_DENIED, ...MCP_USER_ONLY_TOOLS.map(claudeMcpTool)].join(","),
    ...shared,
  ];
}

/**
 * Codex's config for an import turn. Codex reads MCP servers only from its user config, so this
 * workspace's server is defined inline under `ours` and every other one (`others`) is switched
 * off. Plugins and apps are off too, so nothing else can act for the agent.
 */
export function codexImportConfig(
  phase: ImportPhase,
  server: McpLaunch,
  ours: string,
  others: ReadonlyArray<string>,
): string[] {
  const key = codexServerKey(ours);

  const sandbox =
    phase === "read"
      ? [`${key}.enabled_tools=${JSON.stringify(MCP_READ_TOOLS)}`, 'sandbox_mode="read-only"']
      : ['sandbox_mode="workspace-write"', "sandbox_workspace_write.network_access=true"];

  return codexConfig([
    "features.plugins=false",
    "features.apps=false",
    ...others.map((name) => `${codexServerKey(name)}.enabled=false`),
    ...codexServerLaunch(ours, server),
    ...sandbox,
    'approval_policy="never"',
    'web_search="live"',
  ]);
}

const CodexServers = Schema.fromJsonString(Schema.Array(Schema.Struct({ name: Schema.String })));

const decodeCodexServers = Schema.decodeUnknownOption(CodexServers);

/** Listing servers reads a config file; a Codex that takes longer is stuck, not slow. */
const LIST_TIMEOUT = "15 seconds";

/**
 * The MCP servers in the user's Codex config other than `ours`. Without this list a run could
 * reach a server that writes, so it fails when Codex cannot give it.
 */
export const codexOtherServers = Effect.fn("importRun.codexOtherServers")(function* (
  bin: string,
  ours: string,
) {
  const ws = yield* Workspace;

  const failed = new CommandFailed({
    message: "Could not list Codex's MCP servers to keep them out of the import",
  });

  const listed = yield* run(
    bin,
    ["mcp", "list", "--json", ...codexConfig(["features.plugins=false"])],
    { cwd: ws.root },
  ).pipe(Effect.timeoutOrElse({ duration: LIST_TIMEOUT, orElse: () => Effect.fail(failed) }));

  const servers = listed.code === 0 ? decodeCodexServers(listed.stdout) : Option.none();

  if (Option.isNone(servers)) return yield* failed;

  return servers.value.map((server) => server.name).filter((name) => name !== ours);
});

/** Start the agent on the turn and wait for its reply. */
const performTurn = Effect.fnUntraced(function* (input: ImportInput, emit: Emit) {
  const ws = yield* Workspace;
  const { importId, turnId, server } = input;
  const { doc } = yield* getImport(importId);
  const { agent } = doc;
  const turn = doc.turns.find((entry) => entry.id === turnId);

  if (turn === undefined) {
    return yield* new NotFound({ message: `No turn ${turnId} in import ${importId}` });
  }

  yield* emit({ type: "start", subject: turnId, agent });

  const bin = yield* agentBin(agent);
  const phase = importPhase(doc);
  const ours = codexServerName(ws.config.name);

  const flags =
    agent === "claude"
      ? claudeImportFlags(phase, server, doc.link)
      : codexImportConfig(phase, server, ours, yield* codexOtherServers(bin, ours));

  // Without a session to resume, the prompt carries the conversation so far.
  const prompt = (session: SessionArgs) =>
    session.sessionId === undefined ? freshPrompt(doc, turn) : turnMessage(doc, turn);

  return yield* converse({
    agent,
    stored: doc.session,
    invocation: (session) =>
      Effect.succeed({
        ...agentCommand(agent, bin, prompt(session), flags, session),
        env: IMPORT_ENV,
      }),
    save: (sessionId) => saveImportSession(importId, sessionId),
    emit,
  });
});

/** Record how a turn's run ended. A failure here must not hide how the run itself ended. */
const finishTurn = Effect.fnUntraced(function* (
  input: ImportInput,
  end: Omit<RunEnd, "finishedAt">,
) {
  const finishedAt = yield* nowIso;

  yield* endTurn(input.importId, input.turnId, { ...end, finishedAt }).pipe(
    Effect.ignore({ log: true }),
  );
});

/**
 * Run one recorded turn of an import through the user's agent CLI, resuming the import's session.
 * However the turn ends, what the agent installed is recorded before the turn is, so the board
 * sees both when it hears the run ended. Only the agent's part can be stopped; once it is over,
 * the turn is always recorded.
 */
export const runImportTurn = (input: ImportInput, emit: Emit) =>
  Effect.uninterruptibleMask((restore) =>
    Effect.gen(function* () {
      const settle = settleInstalls(input.importId).pipe(Effect.ignore({ log: true }));

      const { reply, failure } = yield* restore(performTurn(input, emit)).pipe(
        Effect.catch((error) => Effect.succeed<TurnResult>({ reply: "", failure: error.message })),
        Effect.onInterrupt(() => Effect.andThen(settle, finishTurn(input, { status: "stopped" }))),
      );

      yield* settle;

      if (failure !== undefined) {
        yield* finishTurn(input, {
          status: "failed",
          error: failure,
          reply: reply === "" ? undefined : reply,
        });

        return yield* emit({ type: "error", error: failure });
      }

      yield* finishTurn(input, { status: "done", reply });
      yield* emit({ type: "done", reply });
    }),
  ).pipe(Effect.withSpan("importRun.runImportTurn"));

const BUSY = "An agent is already working on this import";

/** Imports: one run per import, about one turn of it. */
export const importRuns = <R>(runner: Runner<ImportInput, R>): RunSpec<ImportInput, R> => ({
  key: (input) => input.importId,
  subject: (input) => input.turnId,
  busy: BUSY,
  runner,
});

export class ImportRuns extends Context.Service<ImportRuns, Runs<ImportInput>>()(
  "cutfac/ImportRuns",
) {
  static readonly layer = runsLayer(ImportRuns, importRuns(runImportTurn));
}

/**
 * Record the user's message on the import, then start the agent on it. The message is on the
 * import before this returns, so the board shows it at once.
 */
export const startTurn = Effect.fn("importRun.startTurn")(function* (
  importId: string,
  turn: TurnInput,
  server: McpLaunch,
) {
  const runs = yield* ImportRuns;

  // A second reply waits here and is turned away before it is recorded.
  return yield* runs.exclusive(
    importId,
    Effect.gen(function* () {
      const { doc } = yield* getImport(importId);

      if (yield* runs.isRunning(importId)) return yield* new Conflict({ message: BUSY });

      yield* agentBin(doc.agent);

      const begun = yield* beginTurn(importId, turn, yield* nowIso);
      const input: ImportInput = { importId, turnId: turn.id, server };

      yield* runs
        .start(input)
        .pipe(
          Effect.tapError((error) => finishTurn(input, { status: "failed", error: error.message })),
        );

      return begun;
    }),
  );
});

/** Stop the import's agent, if it is working; resolves once the stop is recorded. */
export const stopImport = Effect.fn("importRun.stopImport")(function* (importId: string) {
  const runs = yield* ImportRuns;

  return yield* runs.exclusive(importId, runs.stop(importId));
});

/**
 * Stop the import's agent, if it is working, and set the import aside before a reply can start
 * another.
 */
export const stopAndCloseImport = Effect.fn("importRun.stopAndCloseImport")(function* (
  importId: string,
) {
  const runs = yield* ImportRuns;

  return yield* runs.exclusive(
    importId,
    Effect.andThen(runs.stop(importId), closeImport(importId)),
  );
});

/** Record a new import and start the agent on its link. */
export const startImport = Effect.fn("importRun.startImport")(function* (
  input: NewImport,
  server: McpLaunch,
) {
  yield* agentBin(input.agent);
  const created = yield* createImport(input);
  const turn: TurnInput = { id: yield* shortId, kind: "start", body: created.doc.link };

  return yield* startTurn(created.id, turn, server);
});
