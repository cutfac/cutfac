import { Effect, Option, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { SIGN_IN_COMMAND, type AgentSetup } from "./agentReadiness.ts";
import {
  type AgentRelease,
  CODEX_INSTALLER,
  detectAgentRelease,
  outdatedAgent,
  versionOf,
} from "./agentVersion.ts";
import { parseClaudeLine } from "./claudeStream.ts";
import { ACCOUNT, CODEX_INITIALIZE, line as codexLine } from "./codexProtocol.ts";
import { commandOptions, run, which } from "./process.ts";
import { AGENTS, type AgentName } from "./schema.ts";

/** Each agent's official installer, which puts the program in ~/.local/bin. */
export const INSTALL_COMMAND: Readonly<Record<AgentName, string>> = {
  claude: "curl -fsSL https://claude.ai/install.sh | bash",
  codex: CODEX_INSTALLER,
};

/** Checking the sign-in reads local credentials and calls no model; one that hangs is skipped. */
const SIGN_IN_TIMEOUT = "10 seconds";

const TRY_SIGN_IN_TIMEOUT = "20 seconds";

const ClaudeAuth = Schema.fromJsonString(Schema.Struct({ loggedIn: Schema.Boolean }));

const decodeClaudeAuth = Schema.decodeUnknownOption(ClaudeAuth);

/**
 * The smallest turn Claude Code takes. `claude auth status` counts a sign-in whose session expired
 * and can't be refreshed as signed in, and only a call to the model tells them apart.
 */
const CLAUDE_SIGN_IN_TRY = [
  "-p",
  "Reply with OK",
  "--model",
  "haiku",
  "--system-prompt",
  "Reply with OK.",
  "--tools",
  "",
  "--strict-mcp-config",
  "--setting-sources",
  "",
  "--disable-slash-commands",
  "--no-session-persistence",
  "--output-format",
  "stream-json",
  "--verbose",
];

/** A try at the sign-in that fails, or takes too long, holds nobody up. */
const unlessTurnedDown = <E, R>(trying: Effect.Effect<boolean, E, R>) =>
  trying.pipe(
    Effect.timeoutOrElse({ duration: TRY_SIGN_IN_TIMEOUT, orElse: () => Effect.succeed(true) }),
    Effect.orElseSucceed(() => true),
  );

const claudeSignInWorks = (bin: string) =>
  unlessTurnedDown(
    Effect.map(
      run(bin, CLAUDE_SIGN_IN_TRY),
      (result) => !result.stdout.split("\n").some((line) => parseClaudeLine(line).signedOut),
    ),
  );

/**
 * The account Codex signs in with. `codex login status` counts a ChatGPT sign-in that can no
 * longer be refreshed as signed in, and `account/read` asks OpenAI, without a model call.
 */
const CODEX_ACCOUNT_READ = [
  CODEX_INITIALIZE,
  codexLine({ method: "initialized" }),
  codexLine({ id: ACCOUNT, method: "account/read", params: { refreshToken: false } }),
].join("");

const decodeAccountAnswer = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      id: Schema.Literal(ACCOUNT),
      result: Schema.Struct({
        account: Schema.NullOr(Schema.Struct({ type: Schema.String })),
        requiresOpenaiAuth: Schema.Boolean,
      }),
    }),
  ),
);

const encoder = new TextEncoder();

/** `codex app-server` answers only while its stdin is open, so it stays open until it has. */
const codexSignInWorks = (bin: string) =>
  unlessTurnedDown(
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const stdin = Stream.concat(Stream.make(encoder.encode(CODEX_ACCOUNT_READ)), Stream.never);

        const handle = yield* spawner.spawn(
          ChildProcess.make(bin, ["app-server"], commandOptions({ stdin })),
        );

        const answer = yield* handle.stdout.pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.map((text) => decodeAccountAnswer(text)),
          Stream.filter(Option.isSome),
          Stream.runHead,
        );

        return Option.match(Option.flatten(answer), {
          onNone: () => true,
          onSome: ({ result }) => result.account !== null || !result.requiresOpenaiAuth,
        });
      }),
    ),
  );

const signedInLocally = (agent: AgentName, bin: string) =>
  (agent === "claude"
    ? Effect.map(run(bin, ["auth", "status", "--json"]), (result) =>
        Option.getOrUndefined(Option.map(decodeClaudeAuth(result.stdout), (auth) => auth.loggedIn)),
      )
    : Effect.map(run(bin, ["login", "status"]), (result) => result.code === 0)
  ).pipe(
    Effect.timeoutOrElse({ duration: SIGN_IN_TIMEOUT, orElse: () => Effect.undefined }),
    Effect.orElseSucceed(() => undefined),
  );

/**
 * Whether the CLI at `bin` is signed in: `claude auth status --json` says so in `loggedIn`, and
 * `codex login status` by its exit code. Undefined when it can't tell, which doesn't hold the user
 * up: a run that needs the sign-in says so itself.
 */
const checkSignIn = Effect.fnUntraced(function* (agent: AgentName, bin: string) {
  const signedIn = yield* signedInLocally(agent, bin);

  if (signedIn !== true) return signedIn;

  return yield* agent === "claude" ? claudeSignInWorks(bin) : codexSignInWorks(bin);
});

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
