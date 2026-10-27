/**
 * Starts the dev app for `bun run desktop:dev`. On macOS it goes through Launch Services, as a
 * Finder double-click does, so the app is the one macOS answers for: a permission granted to
 * Cutfac Dev, such as screen recording, then holds. Spawned straight from a terminal, macOS would
 * ask the terminal's permissions instead, and the grant would never show.
 */
import { createReadStream } from "node:fs";
import path from "node:path";

import { Effect, Fiber, FileSystem, Option, Schedule } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { run } from "../src/core/process.ts";

const PID_WAIT = "15 seconds";

const PID_POLL = "100 millis";

/** A running dev app, however it was started; it is stopped with the scope it was launched in. */
export interface AppProcess {
  /** The app's process once it is up; none if it never showed. */
  readonly pid: Effect.Effect<Option.Option<number>>;
  /** Its exit code, once it has quit. */
  readonly exited: Effect.Effect<number>;
  /** Sends `signal` to the app, if it is still there. */
  readonly kill: (signal: NodeJS.Signals) => Effect.Effect<void>;
}

export interface Launch {
  /** The app's executable: inside the dev bundle on macOS, or stock Electron. */
  readonly executable: string;
  /** The app's code, the repository's root. */
  readonly root: string;
  /** Switches for Electron after the app's path. */
  readonly args: ReadonlyArray<string>;
  /** Open it behind the app in front, as a restart does, so it doesn't take the focus. */
  readonly background: boolean;
  /** What the app needs to find the dev server and the board. */
  readonly env: Readonly<Record<string, string>>;
}

/** The `.app` an executable lives in, when it lives in one. */
const bundleOf = (executable: string) =>
  Option.liftPredicate(path.resolve(executable, "..", "..", ".."), (app) => app.endsWith(".app"));

// Through process.kill, never a Bun subprocess's kill: Bun sends Linux's number for SIGUSR2,
// which is SIGSYS on macOS.
const signal = (pid: number, name: NodeJS.Signals) =>
  Effect.ignore(Effect.try(() => process.kill(pid, name)));

const inherited = { stdin: "ignore", stdout: "inherit", stderr: "inherit" } as const;

/** `handle`'s exit code once it exits, watched from now on; a signal that ended it counts as 1. */
const exitOf = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Effect.map(
    Effect.forkScoped(
      handle.exitCode.pipe(
        Effect.map(Number),
        Effect.orElseSucceed(() => 1),
      ),
    ),
    Fiber.join,
  );

export const launchApp = (launch: Launch) =>
  Option.match(process.platform === "darwin" ? bundleOf(launch.executable) : Option.none(), {
    onNone: () => spawnApp(launch),
    onSome: (bundle) => openApp(bundle, launch),
  });

/** Stock Electron, or another platform: a plain child, which owns its permissions there. */
const spawnApp = Effect.fnUntraced(function* ({ executable, root, args, env }: Launch) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(executable, [root, ...args], {
      cwd: root,
      env,
      extendEnv: true,
      ...inherited,
    }),
  );

  const pid = Number(handle.pid);

  return {
    pid: Effect.succeedSome(pid),
    exited: yield* exitOf(handle),
    kill: (name) => signal(pid, name),
  } satisfies AppProcess;
});

/**
 * Through `open`, which waits until the app quits. Its output comes back over a named pipe, so it
 * still shows in this terminal. `open` doesn't say which process it started, so the app is found by
 * its executable and its argument, which no other app has.
 */
const openApp = Effect.fnUntraced(function* (
  bundle: string,
  { executable, root, args, env, background }: Launch,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const output = yield* outputPipe;

  const opener = yield* spawner.spawn(
    ChildProcess.make(
      "open",
      [
        "-n",
        "-W",
        ...(background ? ["-g"] : []),
        "-a",
        bundle,
        ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        "--stdout",
        output,
        "--stderr",
        output,
        "--args",
        root,
        ...args,
      ],
      inherited,
    ),
  );

  const exited = yield* exitOf(opener);

  const pid = yield* Effect.map(
    Effect.forkScoped(findPid([executable, root, ...args].join(" "), exited)),
    Fiber.join,
  );

  const kill = (name: NodeJS.Signals) =>
    Effect.flatMap(
      pid,
      Option.match({ onNone: () => Effect.void, onSome: (found) => signal(found, name) }),
    );

  // Stopping `open` would leave the app running, so the app is asked to quit and waited for first.
  yield* Effect.addFinalizer(() => Effect.andThen(kill("SIGTERM"), exited));

  return { pid, exited, kill } satisfies AppProcess;
});

/** A named pipe whose every line goes to this terminal, for the app to write its output to. */
const outputPipe = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-dev-" });
  const file = path.join(dir, "output");

  const made = yield* run("mkfifo", [file]);

  if (made.code !== 0) return yield* Effect.die(new Error(`mkfifo ${file} failed`));

  // Read with Node's stream: a pipe has no position to read at, which Effect's file stream uses.
  // Opening it waits for the app to open its end, so this doesn't hold anything up.
  yield* Effect.sync(() => createReadStream(file).pipe(process.stdout, { end: false }));

  return file;
});

/** The process whose command line is `command`, once the app has started it; none if it quit. */
const findPid = (command: string, exited: Effect.Effect<number>) =>
  run("pgrep", ["-n", "-f", `^${escapeRegex(command)}$`]).pipe(
    Effect.map((found): Option.Option<number> =>
      Option.liftPredicate(Number.parseInt(found.stdout, 10), Number.isInteger),
    ),
    Effect.orElseSucceed(Option.none<number>),
    Effect.repeat({ schedule: Schedule.spaced(PID_POLL), until: Option.isSome }),
    Effect.timeoutOrElse({
      duration: PID_WAIT,
      orElse: () => Effect.succeed(Option.none<number>()),
    }),
    Effect.raceFirst(Effect.as(exited, Option.none<number>())),
  );

const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
