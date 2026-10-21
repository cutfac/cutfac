import { Effect, Option } from "effect";

import { realProgram, run, which } from "./process.ts";
import { AGENTS, type AgentName } from "./schema.ts";

/**
 * The oldest release of each agent CLI that Cutfac's flags and output parsing are known to work
 * with. Newer releases are never held back; an older one only gets a warning, since the CLIs
 * change quickly and most of what Cutfac uses is old.
 */
export const MIN_AGENT_VERSION: Readonly<Record<AgentName, string>> = {
  // 2.1.257 added `permissions.blockReadsOutsideWorkingDirectories`, which an import run sets
  // through `--settings`. Every other flag Cutfac passes, such as `--effort xhigh`, `--session-id`
  // with `--resume` and `--allowedTools`, is older than that.
  claude: "2.1.257",
  // 0.122.0 added `codex debug models`, which the model picker reads; the rest of what Cutfac
  // uses, such as `exec resume --json`, is older. 0.128.0 is a few releases on.
  codex: "0.128.0",
};

/** How each agent is named to the people reading a warning. */
const AGENT_TITLE: Readonly<Record<AgentName, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** A three-part release number on its own, not a piece of an address or a longer number. */
const VERSION = /(?<![\d.])(\d+\.\d+\.\d+)(?!\d|\.\d)/;

/**
 * The release number in what an agent prints for `--version`, such as `2.1.301 (Claude Code)` or
 * `codex-cli 0.163.0`. A suffix such as `-beta.1` is dropped. Anything else is undefined.
 */
export const parseAgentVersion = (output: string): string | undefined => VERSION.exec(output)?.[1];

/** Whether the release `version` is older than `minimum`. */
export const isOlderVersion = (version: string, minimum: string) =>
  Bun.semver.order(version, minimum) < 0;

/** An installed agent CLI, as it describes itself. */
export interface AgentRelease {
  readonly version: string;
  /** Where the program really lives, past the links that put it on PATH: it tells how it was installed. */
  readonly installedAt: string;
}

/** A program Homebrew installed, under the cask or formula it came from. */
const HOMEBREW = /\/(Caskroom|Cellar)\/([^/]+)\//;

/** The first Codex with `codex update`, which updates through whatever installed it. */
const CODEX_UPDATES_ITSELF = "0.126.0";

/**
 * What to run to bring an installed agent up to date. A Homebrew install is upgraded as the cask or
 * formula it came from. Otherwise Claude Code updates itself, and so does Codex from 0.126.0; an
 * older Codex is updated through what installed it, as its own update notice says.
 */
export function updateCommand(agent: AgentName, release: AgentRelease): string {
  const [, kind, name] = HOMEBREW.exec(release.installedAt) ?? [];

  if (name !== undefined) {
    return kind === "Caskroom" ? `brew upgrade --cask ${name}` : `brew upgrade ${name}`;
  }

  if (agent === "claude") return "claude update";

  if (!isOlderVersion(release.version, CODEX_UPDATES_ITSELF)) return "codex update";

  if (release.installedAt.includes("/.codex/packages/standalone/")) {
    return "curl -fsSL https://chatgpt.com/codex/install.sh | sh";
  }

  if (release.installedAt.includes("/.bun/")) return "bun install -g @openai/codex@latest";

  return "npm install -g @openai/codex@latest";
}

/** What an agent older than the minimum should be told. */
export interface OutdatedAgent {
  /** The oldest release Cutfac supports. */
  readonly minimum: string;
  /** What to run in a terminal to update the agent. */
  readonly update: string;
}

/** Where `release` falls short of the minimum for `agent`. Undefined when it does not, or is unknown. */
export function outdatedAgent(
  agent: AgentName,
  release: AgentRelease | undefined,
): OutdatedAgent | undefined {
  const minimum = MIN_AGENT_VERSION[agent];

  if (release === undefined || !isOlderVersion(release.version, minimum)) return undefined;

  return { minimum, update: updateCommand(agent, release) };
}

/** What the user's agent is told when the installed `agent` is too old, for it to pass on. */
export const outdatedNotice = (agent: AgentName, version: string, outdated: OutdatedAgent) =>
  `${AGENT_TITLE[agent]} ${version} is older than ${outdated.minimum}, the oldest version Cutfac ` +
  `supports, so some things may not work. Ask the user to update it by running ` +
  `\`${outdated.update}\` in a terminal.`;

/** Asking for a version should not hold anything up; an agent that takes longer is skipped. */
const VERSION_TIMEOUT = "5 seconds";

const reportedVersion = (bin: string) =>
  run(bin, ["--version"]).pipe(
    Effect.map((result) => (result.code === 0 ? parseAgentVersion(result.stdout) : undefined)),
    Effect.timeoutOrElse({ duration: VERSION_TIMEOUT, orElse: () => Effect.undefined }),
    Effect.orElseSucceed(() => undefined),
  );

/** The CLI at `bin`, or undefined when it does not say its version. Never fails. */
export const detectAgentRelease = (bin: string) =>
  Effect.zipWith(
    reportedVersion(bin),
    realProgram(bin),
    (version, installedAt): AgentRelease | undefined =>
      version === undefined ? undefined : { version, installedAt },
    { concurrent: true },
  );

/** `agent` on PATH, or undefined when it is not installed or does not say its version. */
export const installedRelease = (agent: AgentName) =>
  Effect.flatMap(which(agent), (bin) =>
    Option.isSome(bin) ? detectAgentRelease(bin.value) : Effect.undefined,
  );

/** One notice for each installed agent that is older than Cutfac supports. */
export const agentVersionNotices = Effect.fn("agentVersion.notices")(function* () {
  const found = yield* Effect.forEach(
    AGENTS,
    (agent) =>
      Effect.map(installedRelease(agent), (release) => {
        const outdated = outdatedAgent(agent, release);

        return release === undefined || outdated === undefined
          ? []
          : [outdatedNotice(agent, release.version, outdated)];
      }),
    { concurrency: "unbounded" },
  );

  return found.flat();
});

/**
 * Why a run that ended well said nothing Cutfac could read, for the person who sees the failure.
 * An agent whose output changed is the likely cause, so an old one is told to update first.
 */
export function unreadableOutputMessage(
  agent: AgentName,
  release: AgentRelease | undefined,
): string {
  const outdated = outdatedAgent(agent, release);
  const named = release === undefined ? agent : `${agent} ${release.version}`;
  const base = `Couldn't read ${named}'s output; Cutfac may need an update.`;

  return outdated === undefined
    ? base
    : `${base} ${AGENT_TITLE[agent]} is older than ${outdated.minimum}; running \`${outdated.update}\` may fix it.`;
}
