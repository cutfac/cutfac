/**
 * `bun run check:agents [--no-save] [claude] [codex]` checks that the agent CLIs installed here
 * still speak what Cutfac expects. Each one runs headless in a throwaway workspace, built with the
 * same command lines a board run uses, and makes one call to this workspace's MCP server. The
 * output must give Cutfac's parsers a session id, a reply and a tool event, and a second turn must
 * resume the first one. It makes real model calls. Passing, it saves the raw output as fixtures
 * in test/fixtures/, which the unit tests parse; `--no-save` leaves them alone.
 */
// @effect-diagnostics strictEffectProvide:off
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

import { BunServices } from "@effect/platform-bun";
import { Effect, Layer, Option, Schema } from "effect";

import { type AgentInvocation, agentInvocation } from "../src/core/agentCommand.ts";
import { parseClaudeLine, parseCodexLine } from "../src/core/agentParse.ts";
import {
  CLAUDE_MCP_TOOLS,
  SERVER_NAME,
  codexRunServers,
  codexServerName,
  mcpLaunch,
  runMcpConfig,
} from "../src/core/agents.ts";
import { detectAgentRelease, outdatedAgent } from "../src/core/agentVersion.ts";
import { codexServers } from "../src/core/mcpServers.ts";
import { UNINHERITED } from "../src/core/process.ts";
import { AGENTS, type AgentName } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";

const root = path.resolve(import.meta.dir, "..");

const decodeType = Schema.decodeUnknownOption(Schema.String);

const decodeJsonLine = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

export const FIXTURES = path.join(root, "test", "fixtures");

const USAGE = `Usage: bun run check:agents [--no-save] [${AGENTS.join("] [")}]`;

/** The name of the throwaway workspace, which the Codex server it registers is named for. */
const WORKSPACE_NAME = "agent-check";

/** Where the throwaway workspace is made to appear in fixtures, in place of its temp folder. */
export const FIXTURE_ROOT = "/work/agent-check";

/** A turn that has not ended by now is stuck, not slow. */
const TURN_TIMEOUT_MS = 240_000;

/** What the first turn is asked to reply with, and the second turn to repeat. */
const REPLY = "ready-4721";

const REMEMBERED = "4721";

const FIRST_PROMPT =
  `Call the workspace_overview tool of the ${SERVER_NAME} MCP server once. Then reply with ` +
  `exactly ${REPLY} and nothing else.`;

const RESUME_PROMPT =
  "Without calling any tool, repeat the number in the word you replied with just now.";

export interface CheckArgs {
  readonly agents: ReadonlyArray<AgentName>;
  readonly save: boolean;
}

const isAgent = (name: string): name is AgentName => AGENTS.some((agent) => agent === name);

/** Which agents to check (all, unless named) and whether to save fixtures. Throws the usage. */
export function checkArgs(args: ReadonlyArray<string>): CheckArgs {
  const named = args.filter((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg.startsWith("-"));
  const agents = named.filter(isAgent);

  if (agents.length !== named.length || flags.some((flag) => flag !== "--no-save")) {
    throw new Error(USAGE);
  }

  return { agents: agents.length === 0 ? AGENTS : [...new Set(agents)], save: flags.length === 0 };
}

/** What Cutfac made of one turn's output. */
export interface TurnReading {
  readonly sessionId: string | undefined;
  readonly reply: string;
  readonly error: string | undefined;
  /** The name of each tool call the parser saw. */
  readonly tools: ReadonlyArray<string>;
}

/** The session, reply, error and tool calls Cutfac's parser for `agent` finds in `lines`. */
export function readTurn(
  agent: AgentName,
  lines: ReadonlyArray<string>,
  workspace?: string,
): TurnReading {
  const parse = agent === "claude" ? parseClaudeLine : parseCodexLine;
  let reading: TurnReading = { sessionId: undefined, reply: "", error: undefined, tools: [] };

  for (const line of lines) {
    const parsed = parse(line, workspace);

    reading = {
      sessionId: parsed.sessionId ?? reading.sessionId,
      reply: parsed.reply ?? reading.reply,
      error: parsed.error ?? reading.error,
      tools: [
        ...reading.tools,
        ...parsed.events.flatMap((event) => (event.type === "tool" ? [event.name] : [])),
      ],
    };
  }

  return reading;
}

/** What a turn must show, besides ending well. */
export interface Expectation {
  /** Whether the turn made a tool call. */
  readonly tool: boolean;
  /** Text the reply must hold. */
  readonly reply: string;
}

/** What is wrong with a turn that exited with `code`, read as `reading`. Empty when nothing is. */
export function turnProblems(code: number, reading: TurnReading, expected: Expectation): string[] {
  return [
    code === 0 ? undefined : `exited with code ${code}`,
    reading.error === undefined ? undefined : `reported an error: ${reading.error}`,
    reading.sessionId === undefined ? "gave no session id Cutfac could read" : undefined,
    reading.reply.trim() === ""
      ? "gave no reply Cutfac could read"
      : reading.reply.includes(expected.reply)
        ? undefined
        : `replied ${JSON.stringify(reading.reply.slice(0, 80))}, without ${JSON.stringify(expected.reply)}`,
    expected.tool && reading.tools.length === 0 ? "made no tool call Cutfac could see" : undefined,
  ].filter((problem) => problem !== undefined);
}

/** Lines that describe the machine or the account, not the conversation. */
const ABOUT_THE_RUN = ["system", "rate_limit_event"];

/** Values in the other lines that are opaque to Cutfac and say something about the account. */
const OPAQUE = /"(signature|request_id)":"[^"]*"/g;

/**
 * A line of agent output for a fixture. Claude's `system` lines list the tools, skills and plugins
 * of whoever ran the check, and its rate limit lines their account's usage, so only the keys
 * Cutfac reads are kept of those. The opaque signature on its thinking and the API request ids,
 * which lead back to the account, are blanked.
 */
function trimmedLine(line: string): string {
  const parsed = Option.getOrUndefined(decodeJsonLine(line));
  const type = Option.getOrUndefined(decodeType(parsed?.["type"]));

  if (parsed === undefined || type === undefined) return line;

  if (!ABOUT_THE_RUN.includes(type)) return line.replace(OPAQUE, '"$1":""');

  const kept = Object.entries(parsed).filter(([key]) =>
    ["type", "subtype", "session_id"].includes(key),
  );

  return JSON.stringify(Object.fromEntries(kept));
}

/**
 * The lines of `output` as a fixture: the same JSON lines, with the throwaway workspace and the
 * home folder swapped for stand-ins, so nothing about the machine that captured them is kept.
 */
export function fixtureLines(
  output: string,
  swaps: ReadonlyArray<readonly [string, string]>,
): string[] {
  // Longest first, so a folder inside another is not left half-replaced.
  const ordered = swaps.filter(([from]) => from !== "").toSorted(([a], [b]) => b.length - a.length);

  return output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) =>
      ordered.reduce((text, [from, to]) => text.replaceAll(from, to), trimmedLine(line)),
    );
}

interface TurnOutput {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

async function runTurn(invocation: AgentInvocation, cwd: string): Promise<TurnOutput> {
  const child = Bun.spawn([invocation.command, ...invocation.args], {
    cwd,
    env: { ...process.env, ...UNINHERITED, ...invocation.env },
    stdin: new Blob([invocation.stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, TURN_TIMEOUT_MS);

  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { code, stdout, stderr, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

const log = (message: string) => console.log(`[check:agents] ${message}`);

/** A workspace to run the agents in: just enough for this workspace's MCP server to start. */
async function makeCheckWorkspace(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "cutfac-agent-check-"));

  await writeFile(path.join(dir, "cutfac.yaml"), `name: ${WORKSPACE_NAME}\n`);
  await mkdir(path.join(dir, "items"), { recursive: true });

  return dir;
}

/**
 * How each agent is told to reach this workspace's server, built as a board run builds it: Codex
 * also has every other server it lists switched off, plugins' too.
 */
async function serverOptions(agent: AgentName, bin: string, workspace: string) {
  const launch = mcpLaunch(
    { command: process.execPath, args: [path.join(root, "src", "cli.ts")] },
    workspace,
  );

  const inWorkspace = Layer.provideMerge(Workspace.layer(workspace), BunServices.layer);

  if (agent === "claude") {
    const mcpConfig = await Effect.runPromise(Effect.provide(runMcpConfig(launch), inWorkspace));

    return { allowedTools: [CLAUDE_MCP_TOOLS], mcpConfig };
  }

  const listed = await Effect.runPromise(Effect.provide(codexServers(bin), inWorkspace));

  return {
    allowedTools: [],
    codexServer: codexRunServers(codexServerName(WORKSPACE_NAME), launch, listed),
  };
}

interface CheckedTurn {
  readonly name: "first" | "resume";
  readonly problems: ReadonlyArray<string>;
  readonly reading: TurnReading;
  readonly lines: ReadonlyArray<string>;
}

async function checkTurn(
  agent: AgentName,
  bin: string,
  workspace: string,
  name: CheckedTurn["name"],
  sessionId: string | undefined,
): Promise<CheckedTurn> {
  const invocation = agentInvocation(agent, {
    bin,
    prompt: name === "first" ? FIRST_PROMPT : RESUME_PROMPT,
    sessionId,
    newSessionId: crypto.randomUUID(),
    ...(await serverOptions(agent, bin, workspace)),
  });

  const startedAt = Date.now();
  const output = await runTurn(invocation, workspace);
  const lines = output.stdout.split("\n").filter((line) => line.trim() !== "");
  const reading = readTurn(agent, lines, workspace);

  const problems = [
    output.timedOut ? `did not finish in ${TURN_TIMEOUT_MS / 1000} seconds` : undefined,
    ...turnProblems(output.code, reading, {
      tool: name === "first",
      reply: name === "first" ? REPLY : REMEMBERED,
    }),
    ...(output.code !== 0 && output.stderr.trim() !== ""
      ? [`stderr: ${output.stderr.trim().split("\n").slice(-3).join(" / ")}`]
      : []),
  ].filter((problem) => problem !== undefined);

  const seconds = Math.round((Date.now() - startedAt) / 1000);

  if (problems.length === 0) {
    const tools = reading.tools.length === 0 ? "no tool call" : `tool ${reading.tools.join(", ")}`;

    log(`  ${name} turn ok in ${seconds}s: ${tools}, reply ${JSON.stringify(reading.reply)}`);
  } else {
    log(`  ${name} turn FAILED after ${seconds}s:`);

    for (const problem of problems) log(`    - ${problem}`);
  }

  return { name, problems, reading, lines: fixtureLines(output.stdout, await places(workspace)) };
}

/** The folders a fixture must not keep, each with what stands in for it. */
async function places(workspace: string): Promise<Array<readonly [string, string]>> {
  return [
    [workspace, FIXTURE_ROOT],
    [await realpath(workspace), FIXTURE_ROOT],
    [homedir(), "/home/user"],
  ];
}

/** Checks `agent` and says whether it passed; with `save`, a pass also writes its fixtures. */
async function checkAgent(agent: AgentName, save: boolean): Promise<boolean> {
  const bin = Bun.which(agent);

  if (bin === null) {
    log(`${agent}: FAILED. It is not installed or not on PATH.`);

    return false;
  }

  const release = await Effect.runPromise(
    Effect.provide(detectAgentRelease(bin), BunServices.layer),
  );

  const outdated = outdatedAgent(agent, release);

  log(`${agent} ${release?.version ?? "(version unknown)"}`);

  if (outdated !== undefined) {
    log(`  older than ${outdated.minimum}, the oldest Cutfac supports; run \`${outdated.update}\``);
  }

  const workspace = await makeCheckWorkspace();

  try {
    const first = await checkTurn(agent, bin, workspace, "first", undefined);
    const resumed = first.problems.length === 0 ? first.reading.sessionId : undefined;

    // A resume needs the session the first turn reported.
    const second =
      resumed === undefined ? undefined : await checkTurn(agent, bin, workspace, "resume", resumed);

    const passed = second !== undefined && second.problems.length === 0;

    if (second === undefined) log("  resume turn skipped: the first turn failed");

    if (passed && save) {
      await mkdir(FIXTURES, { recursive: true });

      for (const turn of [first, second]) {
        const file = path.join(FIXTURES, `${agent}-${turn.name}.jsonl`);

        await Bun.write(file, `${turn.lines.join("\n")}\n`);
        log(`  saved ${path.relative(root, file)}`);
      }
    }

    return passed;
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

/** Runs the check for the agents `args` name. Resolves to the process exit code. */
export async function checkAgents(args: ReadonlyArray<string>): Promise<number> {
  const { agents, save } = checkArgs(args);
  const results: Array<readonly [AgentName, boolean]> = [];

  for (const agent of agents) results.push([agent, await checkAgent(agent, save)]);

  const failed = results.flatMap(([agent, passed]) => (passed ? [] : [agent]));

  log(
    failed.length === 0
      ? `Cutfac still reads ${agents.join(" and ")}.`
      : `Failed for ${failed.join(" and ")}. If the CLI's output changed, Cutfac's parsers need updating; if the CLI is old, update it.`,
  );

  return failed.length === 0 ? 0 : 1;
}

if (import.meta.main) {
  try {
    process.exitCode = await checkAgents(Bun.argv.slice(2));
  } catch (error) {
    console.error(`[check:agents] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
