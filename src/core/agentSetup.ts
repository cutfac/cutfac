import { Effect, Option, Schema } from "effect";

import type { AgentSetup } from "./agentReadiness.ts";
import {
  type AgentRelease,
  CODEX_INSTALLER,
  detectAgentRelease,
  outdatedAgent,
  versionOf,
} from "./agentVersion.ts";
import { run, which } from "./process.ts";
import { AGENTS, type AgentName } from "./schema.ts";

/** Each agent's official installer, which puts the program in ~/.local/bin. */
export const INSTALL_COMMAND: Readonly<Record<AgentName, string>> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: CODEX_INSTALLER,
};

/** Signing in opens the browser and returns once the sign-in lands. */
export const SIGN_IN_COMMAND: Readonly<Record<AgentName, string>> = {
  claude: "claude auth login --claudeai",
  codex: "codex login",
};

/** Checking the sign-in reads local credentials and calls no model; one that hangs is skipped. */
const SIGN_IN_TIMEOUT = "10 seconds";

const ClaudeAuth = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }));

const decodeClaudeAuth = Schema.decodeUnknownOption(ClaudeAuth);

/**
 * Whether the CLI at `bin` is signed in: `claude auth status --json` says so in `loggedIn`, and
 * `codex login status` by its exit code. Undefined when it can't tell, which doesn't hold the user
 * up: a run that needs the sign-in says so itself.
 */
const checkSignIn = (agent: AgentName, bin: string) =>
  (agent === "claude"
    ? Effect.map(run(bin, ["auth", "status", "--json"]), (result) =>
        Option.getOrUndefined(Option.map(decodeClaudeAuth(result.stdout), (auth) => auth.loggedIn)),
      )
    : Effect.map(run(bin, ["login", "status"]), (result) => result.code === 0)
  ).pipe(
    Effect.timeoutOrElse({ duration: SIGN_IN_TIMEOUT, orElse: () => Effect.undefined }),
    Effect.orElseSucceed(() => undefined),
  );

/** The state an installed agent is in, and what fixes it. */
export function readiness(
  agent: AgentName,
  release: Option.Option<AgentRelease>,
  signedIn: boolean | undefined,
): Omit<AgentSetup, "agent"> {
  const version = versionOf(release);
  const outdated = outdatedAgent(agent, release);

  if (Option.isSome(outdated)) return { state: "outdated", version, fix: outdated.value.update };

  if (signedIn === false) return { state: "signedOut", version, fix: SIGN_IN_COMMAND[agent] };

  return { state: "ready", version };
}

const setupOf = Effect.fn("agentSetup.setupOf")(function* (agent: AgentName) {
  const bin = yield* which(agent);

  if (Option.isNone(bin)) {
    return { agent, state: "missing", fix: INSTALL_COMMAND[agent] } satisfies AgentSetup;
  }

  const [release, signed] = yield* Effect.all(
    [detectAgentRelease(bin.value), checkSignIn(agent, bin.value)],
    { concurrency: "unbounded" },
  );

  return { agent, ...readiness(agent, release, signed) } satisfies AgentSetup;
});

/** Every agent CLI as found on this machine. Needs no workspace, and never fails. */
export const agentSetup = Effect.fn("agentSetup.agentSetup")(function* () {
  const setups: ReadonlyArray<AgentSetup> = yield* Effect.forEach(AGENTS, setupOf, {
    concurrency: "unbounded",
  });

  return setups;
});
