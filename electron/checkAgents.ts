/**
 * `bun run check:agents [--no-save] [claude] [codex]` checks that the agent CLIs installed here
 * still speak what Cutfac expects. Each one runs headless in a throwaway workspace, built with the
 * same command lines a board run uses, and makes one call to this workspace's MCP server. The
 * output must give Cutfac's parsers a session id, a reply and a tool event, and a second turn must
 * resume the first one. It makes real model calls. Passing, it saves the raw output as fixtures
 * in test/fixtures/, which the unit tests parse; `--no-save` leaves them alone.
 */
// @effect-diagnostics strictEffectProvide:off
import path from "node:path";

import {
  type Cause,
  Clock,
  Config,
  Console,
  Crypto,
  Effect,
  FileSystem,
  Option,
  Queue,
  Ref,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { type AgentInvocation, agentInvocation } from "../src/core/agentCommand.ts";
import type { ParsedLine } from "../src/core/agentParse.ts";
import {
  SERVER_NAME,
  codexRunServers,
  codexServerName,
  mcpLaunch,
  runMcpConfig,
} from "../src/core/agents.ts";
import { detectAgentRelease, outdatedAgent, versionOf } from "../src/core/agentVersion.ts";
import { codexServers } from "../src/core/mcpServers.ts";
import { commandOptions, which } from "../src/core/process.ts";
import { AGENTS, type AgentName } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { runScript } from "./script.ts";

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
const TURN_TIMEOUT_SECONDS = 240;

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

export function checkArgs(args: ReadonlyArray<string>): Option.Option<CheckArgs> {
  const named = args.filter((arg) => !arg.startsWith("-"));
  const flags = args.filter((arg) => arg.startsWith("-"));
  const agents = named.filter(isAgent);

  if (agents.length !== named.length || flags.some((flag) => flag !== "--no-save")) {
    return Option.none();
  }

  return Option.some({
    agents: agents.length === 0 ? AGENTS : [...new Set(agents)],
    save: flags.length === 0,
  });
}

/** What Cutfac made of one turn's output. */
export interface TurnReading {
  readonly sessionId: string | undefined;
  readonly reply: string;
  readonly error: string | undefined;
  /** The name of each tool call the parser saw. */
  readonly tools: ReadonlyArray<string>;
}

/** How a run reads each line of its agent's output, as `AgentInvocation.parse` does. */
export type LineParser = AgentInvocation["parse"];

const UNREAD: TurnReading = { sessionId: undefined, reply: "", error: undefined, tools: [] };

const nextReading = (reading: TurnReading, parsed: ParsedLine): TurnReading => ({
  sessionId: parsed.sessionId ?? reading.sessionId,
  reply: parsed.reply ?? reading.reply,
  error: parsed.error ?? reading.error,
  tools: [
    ...reading.tools,
    ...parsed.events.flatMap((event) => (event.type === "tool" ? [event.name] : [])),
  ],
});

/** The session, reply, error and tool calls `parse` finds in `lines`. */
export const readTurn = (parse: LineParser, lines: ReadonlyArray<string>, workspace?: string) =>
  lines.reduce((reading, line) => nextReading(reading, parse(line, workspace)), UNREAD);

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

/** Claude's lines that describe the machine or the account, not the conversation. */
const ABOUT_THE_RUN = ["system", "rate_limit_event"];

/**
 * What of Codex's notifications Cutfac reads, kept whole. The rest, such as the account's rate
 * limits or the user's apps and skills, keep only their method.
 */
const CODEX_READ = new Set([
  "thread/started",
  "turn/started",
  "turn/completed",
  "item/started",
  "item/completed",
  "error",
  "serverRequest/resolved",
]);

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

  if (parsed === undefined) return line;
  const method = Option.getOrUndefined(decodeType(parsed["method"]));

  // Codex's answer to `initialize` names the machine: its OS, and where Codex keeps its files.
  if (parsed["id"] === 1 && method === undefined) return JSON.stringify({ id: 1, result: {} });

  if (method !== undefined) {
    return CODEX_READ.has(method) || "id" in parsed
      ? line.replace(OPAQUE, '"$1":""')
      : JSON.stringify({ method });
  }

  const type = Option.getOrUndefined(decodeType(parsed["type"]));

  if (type === undefined) return line;

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
  readonly lines: ReadonlyArray<string>;
  readonly reading: TurnReading;
  readonly stderr: string;
  readonly timedOut: boolean;
}

const encoder = new TextEncoder();

/**
 * Runs one turn as a board run does: each line read as it comes, what the agent waits on
 * answered on stdin, and stdin closed once the turn ends. Whatever the agent asks the user is
 * turned down, as nobody is there to answer.
 */
const runTurn = Effect.fnUntraced(function* (invocation: AgentInvocation, cwd: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const send = (text: string) => Effect.asVoid(Queue.offer(stdin, encoder.encode(text)));
  const end = Effect.asVoid(Queue.end(stdin));
  const lines = yield* Ref.make<ReadonlyArray<string>>([]);
  const reading = yield* Ref.make(UNREAD);

  const take = Effect.fnUntraced(function* (line: string) {
    if (line.trim() === "") return;

    yield* Ref.update(lines, (all) => [...all, line]);

    const parsed = invocation.parse(line, cwd);
    const control = parsed.control;

    yield* Ref.update(reading, (now) => nextReading(now, parsed));

    if (control?.kind === "reply") yield* Effect.forEach(control.lines, send, { discard: true });

    if (control?.kind === "ask") yield* send(control.request.answer("deny"));

    if (parsed.ended === true) yield* end;
  });

  yield* send(invocation.stdin);

  const ran = yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(invocation.command, invocation.args, {
          ...commandOptions({ cwd, stdin: Stream.fromQueue(stdin), env: invocation.env }),
        }),
      );

      const [, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach(take),
            Effect.andThen(end),
          ),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          Effect.map(handle.exitCode, Number),
        ],
        { concurrency: "unbounded" },
      );

      return { code, stderr };
    }),
  ).pipe(Effect.timeoutOption(`${TURN_TIMEOUT_SECONDS} seconds`));

  const output: TurnOutput = {
    code: Option.match(ran, { onNone: () => 1, onSome: ({ code }) => code }),
    lines: yield* Ref.get(lines),
    reading: yield* Ref.get(reading),
    stderr: Option.match(ran, { onNone: () => "", onSome: ({ stderr }) => stderr }),
    timedOut: Option.isNone(ran),
  };

  return output;
});

const log = (message: string) => Console.log(`[check:agents] ${message}`);

/** A workspace to run the agents in: just enough for this workspace's MCP server to start. */
const checkWorkspace = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-agent-check-" });

  yield* fs.writeFileString(path.join(dir, "cutfac.yaml"), `name: ${WORKSPACE_NAME}\n`);
  yield* fs.makeDirectory(path.join(dir, "items"), { recursive: true });

  return dir;
});

/**
 * How each agent is told to reach this workspace's server, built as a board run builds it: Codex
 * also has every other server it lists switched off, plugins' too.
 */
const serverOptions = Effect.fnUntraced(
  function* (agent: AgentName, bin: string, workspace: string) {
    const launch = mcpLaunch(
      { command: process.execPath, args: [path.join(root, "src", "cli.ts")] },
      workspace,
    );

    if (agent === "claude") return { mcpConfig: yield* runMcpConfig(launch) };

    const listed = yield* codexServers(bin);

    return { codexConfig: codexRunServers(codexServerName(WORKSPACE_NAME), launch, listed) };
  },
  (options, _agent, _bin, workspace) => Effect.provide(options, Workspace.layer(workspace)),
);

interface CheckedTurn {
  readonly name: "first" | "resume";
  readonly problems: ReadonlyArray<string>;
  readonly reading: TurnReading;
  readonly lines: ReadonlyArray<string>;
}

const checkTurn = Effect.fnUntraced(function* (
  agent: AgentName,
  bin: string,
  workspace: string,
  name: CheckedTurn["name"],
  sessionId: string | undefined,
) {
  const crypto = yield* Crypto.Crypto;

  const invocation = agentInvocation(agent, {
    bin,
    prompt: name === "first" ? FIRST_PROMPT : RESUME_PROMPT,
    sessionId,
    newSessionId: yield* Effect.orDie(crypto.randomUUIDv4()),
    ...(yield* serverOptions(agent, bin, workspace)),
  });

  const startedAt = yield* Clock.currentTimeMillis;
  const output = yield* runTurn(invocation, workspace);
  const reading = output.reading;

  const problems = [
    output.timedOut ? `did not finish in ${TURN_TIMEOUT_SECONDS} seconds` : undefined,
    ...turnProblems(output.code, reading, {
      tool: name === "first",
      reply: name === "first" ? REPLY : REMEMBERED,
    }),
    ...(output.code !== 0 && output.stderr.trim() !== ""
      ? [`stderr: ${output.stderr.trim().split("\n").slice(-3).join(" / ")}`]
      : []),
  ].filter((problem) => problem !== undefined);

  const seconds = Math.round(((yield* Clock.currentTimeMillis) - startedAt) / 1000);

  if (problems.length === 0) {
    const tools = reading.tools.length === 0 ? "no tool call" : `tool ${reading.tools.join(", ")}`;

    yield* log(
      `  ${name} turn ok in ${seconds}s: ${tools}, reply ${JSON.stringify(reading.reply)}`,
    );
  } else {
    yield* log(`  ${name} turn FAILED after ${seconds}s:`);
    yield* Effect.forEach(problems, (problem) => log(`    - ${problem}`), { discard: true });
  }

  const checked: CheckedTurn = {
    name,
    problems,
    reading,
    lines: fixtureLines(output.lines.join("\n"), yield* places(workspace)),
  };

  return checked;
});

/** The folders a fixture must not keep, each with what stands in for it. */
const places = Effect.fnUntraced(function* (workspace: string) {
  const fs = yield* FileSystem.FileSystem;
  const home = yield* Config.String("HOME");

  const swaps: Array<readonly [string, string]> = [
    [workspace, FIXTURE_ROOT],
    [yield* fs.realPath(workspace), FIXTURE_ROOT],
    [home, "/home/user"],
  ];

  return swaps;
});

/** Checks `agent` and says whether it passed; with `save`, a pass also writes its fixtures. */
const checkAgent = Effect.fnUntraced(function* (agent: AgentName, save: boolean) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* which(agent);

  if (Option.isNone(found)) {
    yield* log(`${agent}: FAILED. It is not installed or not on PATH.`);

    return false;
  }

  const bin = found.value;
  const release = yield* detectAgentRelease(bin);
  const outdated = outdatedAgent(agent, release);

  yield* log(`${agent} ${versionOf(release) ?? "(version unknown)"}`);

  if (Option.isSome(outdated)) {
    const { minimum, update } = outdated.value;

    yield* log(`  older than ${minimum}, the oldest Cutfac supports; run \`${update}\``);
  }

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const workspace = yield* checkWorkspace;
      const first = yield* checkTurn(agent, bin, workspace, "first", undefined);
      const resumed = first.problems.length === 0 ? first.reading.sessionId : undefined;

      if (resumed === undefined) {
        yield* log("  resume turn skipped: the first turn failed");

        return false;
      }

      const second = yield* checkTurn(agent, bin, workspace, "resume", resumed);
      const passed = second.problems.length === 0;

      if (passed && save) {
        yield* fs.makeDirectory(FIXTURES, { recursive: true });

        for (const turn of [first, second]) {
          const file = path.join(FIXTURES, `${agent}-${turn.name}.jsonl`);

          yield* fs.writeFileString(file, `${turn.lines.join("\n")}\n`);
          yield* log(`  saved ${path.relative(root, file)}`);
        }
      }

      return passed;
    }),
  );
});

export const checkAgents = Effect.fn("checkAgents")(function* (args: ReadonlyArray<string>) {
  const parsed = checkArgs(args);

  if (Option.isNone(parsed)) {
    yield* Console.error(`[check:agents] ${USAGE}`);

    return 1;
  }

  const { agents, save } = parsed.value;

  const results = yield* Effect.forEach(agents, (agent) =>
    Effect.map(checkAgent(agent, save), (passed) => [agent, passed] as const),
  );

  const failed = results.flatMap(([agent, passed]) => (passed ? [] : [agent]));

  yield* log(
    failed.length === 0
      ? `Cutfac still reads ${agents.join(" and ")}.`
      : `Failed for ${failed.join(" and ")}. If the CLI's output changed, Cutfac's parsers need updating; if the CLI is old, update it.`,
  );

  return failed.length === 0 ? 0 : 1;
});

if (import.meta.main) runScript("check:agents", checkAgents(Bun.argv.slice(2)));
