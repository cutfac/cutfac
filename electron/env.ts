import { userInfo } from "node:os";
import path from "node:path";

import { Effect, Option, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CommandFailed } from "../src/core/errors.ts";
import { run } from "../src/core/process.ts";

const ENV_MARKER = "__CUTFAC_ENV__";

/** What launchd gives GUI apps before anything else is added. */
const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** Shell bookkeeping that would describe the shell that printed the environment, not the server. */
const SHELL_STATE = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

const SHELL_TIMEOUT = "5 seconds";

export type Env = Record<string, string>;

/** Who the app runs as, from the user database rather than the environment it was launched with. */
export interface Account {
  readonly home: string;
  readonly user: string;
  readonly shell: Option.Option<string>;
  /** The per-user temporary folder macOS assigns, when the system reports one. */
  readonly tmpdir: Option.Option<string>;
}

const nonEmpty = (text: string) => Option.liftPredicate(text, (value) => value !== "");

export const readAccount = Effect.gen(function* () {
  const { homedir, username, shell } = yield* Effect.sync(() => userInfo());

  const tmpdir = yield* run("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"]).pipe(
    Effect.map(({ code, stdout }) => (code === 0 ? nonEmpty(stdout.trim()) : Option.none())),
    // Not macOS; programs fall back to /tmp.
    Effect.orElseSucceed(() => Option.none<string>()),
  );

  return {
    home: homedir,
    user: username,
    shell: Option.flatMap(Option.fromNullishOr(shell), nonEmpty),
    tmpdir,
  } satisfies Account;
});

/** PATH entries in order, without repeats or empty entries. */
export function joinPath(...paths: (string | undefined)[]): string {
  const entries = paths.flatMap((value) => value?.split(path.delimiter) ?? []);

  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

/**
 * What a fresh terminal has before the user's shell files run, built only from the account, so
 * nothing in the environment the app was launched with gets through.
 */
export interface CleanEnv {
  HOME: string;
  USER: string;
  LOGNAME: string;
  /** The system folders, then Homebrew, Bun and the agents' own installs in case the shell can't be read. */
  PATH: string;
  SHELL?: string;
  TMPDIR?: string;
  /** The session's ssh agent, which launchd hands every app, so agents can still use git over ssh. */
  SSH_AUTH_SOCK?: string;
}

export function cleanEnv(
  account: Account,
  inherited: Readonly<Record<string, string | undefined>>,
): CleanEnv {
  const env: CleanEnv = {
    HOME: account.home,
    USER: account.user,
    LOGNAME: account.user,
    PATH: joinPath(
      ...SYSTEM_PATH,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(account.home, ".bun", "bin"),
      // Where the Claude Code and Codex installers put their programs, before a new shell has it.
      path.join(account.home, ".local", "bin"),
    ),
  };

  if (Option.isSome(account.shell)) env.SHELL = account.shell.value;

  if (Option.isSome(account.tmpdir)) env.TMPDIR = account.tmpdir.value;

  const sshAgent = inherited["SSH_AUTH_SOCK"];

  if (sshAgent) env.SSH_AUTH_SOCK = sshAgent;

  return env;
}

/** Reads the `env -0` output fenced by markers, ignoring whatever the shell's files printed. */
export function parseEnv(output: string): Option.Option<Env> {
  const start = output.indexOf(ENV_MARKER);
  const end = output.lastIndexOf(ENV_MARKER);

  if (start === -1 || end === start) return Option.none();

  const env: Env = {};

  for (const entry of output.slice(start + ENV_MARKER.length, end).split("\0")) {
    const equals = entry.indexOf("=");

    if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1);
  }

  return Option.some(env);
}

/**
 * GUI apps on macOS start with launchd's minimal environment, but agents expect what a terminal
 * gives them: the PATH to claude, codex, ffmpeg and yt-dlp, API keys and tool settings. So the
 * user's login shell starts from `clean` in their home folder, as a terminal would, and prints its
 * environment. None if the shell can't be run or printed nothing readable.
 */
export const readShellEnv = Effect.fn("env.readShellEnv")(function* (
  shell: string,
  clean: CleanEnv,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const marker = `printf '%s' ${ENV_MARKER}`;

  const command = ChildProcess.make(shell, ["-ilc", `${marker}; /usr/bin/env -0; ${marker}`], {
    cwd: clean.HOME,
    env: { ...clean },
    extendEnv: false,
    // In the app's own process group, so what the shell's files start in the background stays.
    detached: false,
  });

  const printed = Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(command);

      const [stdout, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
          handle.stderr.pipe(Stream.runDrain),
        ],
        { concurrency: "unbounded" },
      );

      if (code !== 0) return yield* new CommandFailed({ message: `${shell} exited with ${code}` });

      return parseEnv(stdout);
    }),
  );

  return yield* printed.pipe(
    Effect.timeout(SHELL_TIMEOUT),
    Effect.catch((error) =>
      Effect.as(
        Effect.logWarning("Could not read the login shell environment", error),
        Option.none<Env>(),
      ),
    ),
  );
});

/**
 * The server's environment: the login shell's, or `clean` when it couldn't be read. The server is a
 * Bun binary, which takes options from BUN_* variables (BUN_OPTIONS can preload a script and
 * BUN_BE_BUN turns it into the bun command), and it and many tools agents run let DYLD_* variables
 * load libraries into them. Neither belongs in a terminal's environment, so both are dropped,
 * except BUN_INSTALL, which only tells `bun` where it's installed.
 */
export function serverEnv(shell: Option.Option<Env>, clean: CleanEnv) {
  const login = Option.getOrElse(shell, (): Env => ({}));
  const kept = Object.entries({ ...clean, ...login }).filter(([name]) => !isDropped(name));

  return { ...Object.fromEntries(kept), PATH: joinPath(login["PATH"], clean.PATH) };
}

function isDropped(name: string): boolean {
  if (name === "BUN_INSTALL") return false;

  return name.startsWith("BUN_") || name.startsWith("DYLD_") || SHELL_STATE.has(name);
}
