import { Config, Effect, FileSystem, Option, Predicate, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CommandFailed } from "./errors.ts";

export interface RunOptions {
  readonly cwd?: string;
  /** Written to the process's stdin, which is closed after it, or when the stream ends. */
  readonly stdin?: string | Stream.Stream<Uint8Array, PlatformError> | undefined;
  /** Added to the environment the command inherits. */
  readonly env?: Readonly<Record<string, string>> | undefined;
}

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

const SearchPath = Config.option(Config.String("PATH"));

/**
 * The absolute path of `name` on PATH, if it is installed. PATH comes from the config provider, so
 * a test can point it at fake programs.
 */
export const which = (name: string): Effect.Effect<Option.Option<string>> =>
  Effect.gen(function* () {
    const PATH = yield* Effect.orElseSucceed(SearchPath, Option.none);

    return Option.fromNullishOr(
      Option.match(PATH, {
        onNone: () => Bun.which(name),
        onSome: (path) => Bun.which(name, { PATH: path }),
      }),
    );
  });

/** Where the program at `bin` really lives, past the links that put it on PATH; `bin` if unreadable. */
export const realProgram = Effect.fnUntraced(function* (bin: string) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.realPath(bin).pipe(Effect.orElseSucceed(() => bin));
});

export const isInstalled = (name: string): Effect.Effect<boolean> =>
  Effect.map(which(name), Option.isSome);

/** Why a command could not start: a missing binary reads better than a raw spawn error. */
export const spawnFailure = (command: string) => (error: PlatformError) =>
  new CommandFailed({
    message: Predicate.isTagged(error.reason, "NotFound")
      ? `${command} is not installed or not on PATH`
      : `Could not run ${command}: ${error.message}`,
  });

/** SIGTERM first so a command can stop its own children; SIGKILL if it is still there after this. */
export const STOP_GRACE = "3 seconds";

const encoder = new TextEncoder();

/**
 * Variables a command doesn't inherit from the app. The Codex desktop app sets
 * CODEX_APP_SERVER_USE_LOCAL_DAEMON for every app the user opens, and with it set to anything,
 * `codex exec` and `codex mcp` refuse to run.
 */
export const UNINHERITED = {
  CODEX_APP_SERVER_USE_LOCAL_DAEMON: undefined,
} satisfies Readonly<Record<string, undefined>>;

const stdinOf = (stdin: RunOptions["stdin"]) => {
  if (stdin === undefined) return "ignore";

  return Predicate.isString(stdin) ? Stream.make(encoder.encode(stdin)) : stdin;
};

export function commandOptions(options: RunOptions): ChildProcess.CommandOptions {
  return {
    cwd: options.cwd,
    stdin: stdinOf(options.stdin),
    env: { ...UNINHERITED, ...options.env },
    extendEnv: true,
  };
}

/** Run a command to completion and collect its output, whatever its exit code. */
export const run = Effect.fn("process.run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner.spawn(
        ChildProcess.make(command, args, commandOptions(options)),
      );

      const [stdout, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(Stream.decodeText(), Stream.mkString),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      const result: CommandResult = { code, stdout, stderr };

      return result;
    }),
  ).pipe(Effect.mapError(spawnFailure(command)));
});

/** The last few lines of a failed command's stderr, enough to say what went wrong. */
export function tail(text: string, lines = 6): string {
  return text.trim().split("\n").slice(-lines).join("\n");
}

/** Run a command and fail with its stderr unless it exits 0. Resolves to stdout. */
export const runChecked = Effect.fn("process.runChecked")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: RunOptions = {},
) {
  const result = yield* run(command, args, options);

  if (result.code !== 0) {
    const detail = tail(result.stderr);

    return yield* new CommandFailed({
      message: `${command} exited with code ${result.code}${detail === "" ? "" : `: ${detail}`}`,
    });
  }

  return result.stdout;
});
