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
  // with `--resume`, `--allowedTools` and `--permission-prompt-tool stdio`, is older than that.
  claude: "2.1.257",
  // 0.128.0 has all of `codex app-server` that a run uses: `thread/resume` with `excludeTurns`,
  // `approvalsReviewer`, `item/permissions/requestApproval`, MCP tool approvals asked as
  // elicitations, and a server's per-tool `approval_mode`. `codex debug models`, which the model
  // picker reads, is older.
  codex: "0.128.0",
};

/** How each agent is named to the people reading a warning. */
export const AGENT_TITLE: Readonly<Record<AgentName, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** A three-part release number on its own, not a piece of an address or a longer number. */
const VERSION = /(?<![\d.])(\d+\.\d+\.\d+)(?!\d|\.\d)/;

export const parseAgentVersion = (output: string) =>
  Option.fromNullishOr(VERSION.exec(output)?.[1]);

/** Whether the release `version` is older than `minimum`. */
export const isOlderVersion = (version: string, minimum: string) =>
  Bun.semver.order(version, minimum) < 0;

/** An installed agent CLI, as it describes itself. */
export interface AgentRelease {
  readonly version: string;
  /** Where the program really lives, past the links that put it on PATH: it tells how it was installed. */
  readonly installedAt: string;
}

export const versionOf = (release: Option.Option<AgentRelease>) =>
  Option.getOrUndefined(Option.map(release, (known) => known.version));

/** A program Homebrew installed, under the cask or formula it came from. */
const HOMEBREW = /\/(Caskroom|Cellar)\/([^/]+)\//;

/** The first Codex with `codex update`, which updates through whatever installed it. */
const CODEX_UPDATES_ITSELF = "0.126.0";

/** Codex's official installer, which also updates a copy it put there. */
export const CODEX_INSTALLER = "curl -fsSL https://chatgpt.com/codex/install.sh | sh";

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
    return CODEX_INSTALLER;
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

export function outdatedAgent(
  agent: AgentName,
  release: Option.Option<AgentRelease>,
): Option.Option<OutdatedAgent> {
  const minimum = MIN_AGENT_VERSION[agent];

  return release.pipe(
    Option.filter((known) => isOlderVersion(known.version, minimum)),
    Option.map((known) => ({ minimum, update: updateCommand(agent, known) })),
  );
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
    Effect.map((result) =>
      result.code === 0 ? parseAgentVersion(result.stdout) : Option.none<string>(),
    ),
    Effect.timeoutOrElse({ duration: VERSION_TIMEOUT, orElse: () => Effect.succeedNone }),
    Effect.orElseSucceed(Option.none<string>),
  );

export const detectAgentRelease = (bin: string) =>
  Effect.zipWith(
    reportedVersion(bin),
    realProgram(bin),
    (version, installedAt): Option.Option<AgentRelease> =>
      Option.map(version, (known) => ({ version: known, installedAt })),
    { concurrent: true },
  );

export const installedRelease = (agent: AgentName) =>
  Effect.flatMap(which(agent), (bin) =>
    Option.match(bin, { onNone: () => Effect.succeedNone, onSome: detectAgentRelease }),
  );

/** One notice for each installed agent that is older than Cutfac supports. */
export const agentVersionNotices = Effect.fn("agentVersion.notices")(function* () {
  const found = yield* Effect.forEach(
    AGENTS,
    (agent) =>
      Effect.map(installedRelease(agent), (release) =>
        Option.toArray(
          Option.zipWith(release, outdatedAgent(agent, release), (known, outdated) =>
            outdatedNotice(agent, known.version, outdated),
          ),
        ),
      ),
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
  release: Option.Option<AgentRelease>,
): string {
  const named = Option.match(release, {
    onNone: () => agent,
    onSome: (known) => `${agent} ${known.version}`,
  });

  const base = `Couldn't read ${named}'s output; Cutfac may need an update.`;

  return Option.match(outdatedAgent(agent, release), {
    onNone: () => base,
    onSome: (outdated) =>
      `${base} ${AGENT_TITLE[agent]} is older than ${outdated.minimum}; running \`${outdated.update}\` may fix it.`,
  });
}
