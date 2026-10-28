import path from "node:path";

import {
  Console,
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Option,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";
import { HttpClient } from "effect/http";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { STOP_GRACE, whichIn } from "../src/core/process.ts";
import type { AgentName } from "../src/core/schema.ts";
import { isWorkspaceRoot } from "../src/core/workspaceRoot.ts";
import { cleanEnv, joinPath, readAccount, readShellEnv, serverEnv } from "./env.ts";
import { bindPort, freePort, HOST } from "./ports.ts";

const CLI_TIMEOUT = "30 seconds";

const HEALTH_TIMEOUT_SECONDS = 20;

const HEALTH_POLL = "150 millis";

const PING_TIMEOUT = "1 second";

const DRAIN_WAIT = "500 millis";

const OUTPUT_TAIL_LINES = 40;

export type Env = Readonly<Record<string, string | undefined>>;

export class SidecarFailed extends Schema.TaggedError<SidecarFailed>()("SidecarFailed", {
  message: Schema.String,
}) {}

export interface InstallInfo {
  readonly packaged: boolean;
  readonly appPath: string;
  readonly resourcesPath: string;
  readonly logsPath: string;
  readonly homePath: string;
  readonly launchEnv: Env;
  readonly devPort: Option.Option<number>;
}

export class Install extends Context.Service<Install, InstallInfo>()("cutfac/desktop/Install") {}

/**
 * The packaged app gives the server its user's terminal environment and nothing from the
 * environment it was launched with, so another program can't open it with variables that make
 * the server, or the agents it runs, load their code under the app's permissions. From a checkout
 * the app was started from the developer's own terminal or editor, so that is kept and only the
 * PATH is widened.
 */
const readServerEnv = Effect.gen(function* () {
  const install = yield* Install;

  // The desktop app ships for macOS only; elsewhere there's no login shell to ask.
  if (process.platform === "win32") return install.launchEnv;

  const account = yield* readAccount;
  const clean = cleanEnv(account, install.launchEnv);

  const shell = yield* Option.match(account.shell, {
    onNone: () => Effect.succeedNone,
    onSome: (login) => readShellEnv(login, clean),
  });

  const env = serverEnv(shell, clean);

  if (install.packaged) return env;

  // The bundled server finds the app's logs folder itself; one run from source is told it.
  return {
    ...install.launchEnv,
    PATH: joinPath(install.launchEnv["PATH"], env.PATH),
    CUTFAC_LOG_DIR: install.logsPath,
  };
});

export class ServerEnv extends Context.Service<ServerEnv, Env>()("cutfac/desktop/ServerEnv") {
  static readonly layer = Layer.effect(ServerEnv, readServerEnv);
}

export const boardDirOf = (install: InstallInfo) =>
  install.packaged
    ? path.join(install.resourcesPath, "web")
    : path.join(install.appPath, "dist", "web");

interface Launch {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly webDir: string;
  readonly watchFlags: ReadonlyArray<string>;
}

/**
 * The compiled binary in the packaged app, `bun src/cli.ts` from a checkout. From a checkout,
 * CUTFAC_SIDECAR points at any executable that speaks the sidecar CLI (used to test the shell
 * without the real server); the packaged app runs only its own.
 */
const resolveLaunch = Effect.gen(function* () {
  const install = yield* Install;
  const webDir = boardDirOf(install);

  if (install.packaged) {
    const command = path.join(install.resourcesPath, "bin", "cutfac");

    return { command, args: [], webDir, watchFlags: [] } satisfies Launch;
  }

  const override = install.launchEnv["CUTFAC_SIDECAR"];

  if (override) return { command: override, args: [], webDir, watchFlags: [] } satisfies Launch;

  const env = yield* ServerEnv;

  const bun = yield* whichIn("bun", env["PATH"] ?? "");

  if (Option.isNone(bun)) {
    return yield* new SidecarFailed({
      message: "`bun` is not on PATH. Install Bun (https://bun.sh) to run from source.",
    });
  }

  return {
    command: bun.value,
    args: [path.join(install.appPath, "src", "cli.ts")],
    webDir,
    // Bun re-executes in place, so the process (and the app's handle on it) survives a reload.
    watchFlags: ["--watch"],
  } satisfies Launch;
});

const nodeMessage = (error: PlatformError) =>
  error.cause instanceof Error ? error.cause.message : error.message;

interface Running {
  readonly handle: ChildProcessSpawner.ChildProcessHandle;
  readonly tail: Ref.Ref<ReadonlyArray<string>>;
  readonly output: Fiber.Fiber<void>;
}

const forward = (
  stream: Stream.Stream<Uint8Array, PlatformError>,
  print: (line: string) => Effect.Effect<void>,
  keep: (line: string) => Effect.Effect<void> = () => Effect.void,
) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.runForEach((line) => Effect.andThen(keep(line), print(`[sidecar] ${line}`))),
  );

const childOptions = (cwd: string, env: Env): ChildProcess.CommandOptions => ({
  cwd,
  env,
  extendEnv: false,
  stdin: "ignore",
  detached: false,
  forceKillAfter: STOP_GRACE,
});

const spawn = Effect.fnUntraced(function* (
  launch: Launch,
  args: ReadonlyArray<string>,
  cwd: string,
  what: string,
  env: Env,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const command = ChildProcess.make(
    launch.command,
    [...launch.args, ...args],
    childOptions(cwd, { ...(yield* ServerEnv), ...env }),
  );

  const handle = yield* spawner
    .spawn(command)
    .pipe(
      Effect.mapError(
        (error) =>
          new SidecarFailed({ message: `${what} could not be started (${nodeMessage(error)}).` }),
      ),
    );

  const tail = yield* Ref.make<ReadonlyArray<string>>([]);

  const keep = (line: string) =>
    Ref.update(tail, (lines) => [...lines, line].slice(-OUTPUT_TAIL_LINES));

  const output = yield* Effect.all(
    [forward(handle.stdout, Console.log, keep), forward(handle.stderr, Console.error, keep)],
    { concurrency: 2, discard: true },
  ).pipe(Effect.ignore, Effect.forkDetach);

  return { handle, tail, output } satisfies Running;
});

const stillRunning = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  Effect.orElseSucceed(handle.isRunning, () => false);

const KILLED_BY = /signal: '(\w+)'/;

const endOf = (handle: ChildProcessSpawner.ChildProcessHandle) =>
  handle.exitCode.pipe(
    Effect.match({
      onSuccess: (code) => `exited with code ${code}`,
      // Node gives a process a signal killed no exit code; the spawner's error names the signal.
      onFailure: (error) =>
        Option.match(Option.fromNullishOr(KILLED_BY.exec(nodeMessage(error))?.[1]), {
          onNone: () => "was killed",
          onSome: (signal) => `was killed by ${signal}`,
        }),
    }),
  );

const describeEnd = Effect.fnUntraced(function* (running: Running, what: string) {
  yield* Effect.timeoutOption(Fiber.await(running.output), DRAIN_WAIT);

  const tail = yield* Ref.get(running.tail);
  const output = tail.length > 0 ? `\n\nLast output:\n${tail.join("\n")}` : "";

  return `${what} ${yield* endOf(running.handle)}.${output}`;
});

const answers = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.map((response) => response.status >= 200 && response.status < 300),
    Effect.timeout(PING_TIMEOUT),
    Effect.orElseSucceed(() => false),
  );

const untilHealthy = (url: string, server: Running) => {
  const poll = Effect.gen(function* () {
    while (yield* stillRunning(server.handle)) {
      if (yield* answers(url)) return;

      yield* Effect.sleep(HEALTH_POLL);
    }

    return yield* new SidecarFailed({ message: yield* describeEnd(server, "The local server") });
  });

  const tooSlow = Effect.gen(function* () {
    yield* Effect.ignore(server.handle.kill({ forceKillAfter: STOP_GRACE }));

    return yield* new SidecarFailed({
      message: yield* describeEnd(
        server,
        `The local server did not answer within ${HEALTH_TIMEOUT_SECONDS}s and`,
      ),
    });
  });

  return Effect.timeoutOrElse(poll, {
    duration: Duration.seconds(HEALTH_TIMEOUT_SECONDS),
    orElse: () => tooSlow,
  });
};

const setUp = (launch: Launch, workspace: string, agent: AgentName | undefined, env: Env) =>
  Effect.scoped(
    Effect.gen(function* () {
      const init = yield* spawn(
        launch,
        ["init", workspace, "--no-connect", ...(agent === undefined ? [] : ["--agent", agent])],
        workspace,
        "Workspace setup",
        env,
      );

      const ended = yield* Effect.exit(init.handle.exitCode);

      if (Exit.isSuccess(ended) && ended.value === 0) return;

      return yield* new SidecarFailed({ message: yield* describeEnd(init, "Workspace setup") });
    }),
  );

const reportCrashUntilStopped = (
  server: Running,
  stoppedWith: Scope.Closeable,
  onCrash: (message: string) => Effect.Effect<void>,
) =>
  Effect.exit(server.handle.exitCode).pipe(
    Effect.andThen(describeEnd(server, "The local server")),
    Effect.flatMap(onCrash),
    Effect.forkIn(stoppedWith),
  );

export interface SidecarOptions {
  readonly workspace: string;
  /** The agent a workspace made now sends requests to. */
  readonly agent?: AgentName | undefined;
  readonly port: { readonly fixed: number } | { readonly last: Option.Option<number> };
  readonly watch: boolean;
  /** Variables the server and its setup get on top of the app's. */
  readonly env: Env;
  readonly onCrash: (message: string) => Effect.Effect<void>;
}

export interface Sidecar {
  readonly url: string;
  readonly port: number;
  readonly stop: Effect.Effect<void>;
  readonly kill: Effect.Effect<void>;
}

const serve = Effect.fnUntraced(function* (options: SidecarOptions, scope: Scope.Closeable) {
  const choice = options.port;
  const port = yield* "fixed" in choice ? bindPort(choice.fixed) : freePort(choice.last);
  const launch = yield* resolveLaunch;

  if (!(yield* isWorkspaceRoot(options.workspace))) {
    yield* setUp(launch, options.workspace, options.agent, options.env);
  }

  const server = yield* spawn(
    options.watch ? { ...launch, args: [...launch.watchFlags, ...launch.args] } : launch,
    [
      "serve",
      "--workspace",
      options.workspace,
      "--port",
      String(port),
      "--host",
      HOST,
      "--web-dir",
      launch.webDir,
    ],
    options.workspace,
    "The local server",
    options.env,
  ).pipe(Scope.provide(scope));

  const url = `http://${HOST}:${port}/`;

  yield* untilHealthy(`${url}api/health`, server);

  yield* reportCrashUntilStopped(server, scope, options.onCrash);

  const { handle } = server;

  const kill = Effect.flatMap(stillRunning(handle), (running) =>
    running ? Effect.try(() => process.kill(handle.pid, "SIGKILL")) : Effect.void,
  );

  return {
    url,
    port,
    stop: Scope.close(scope, Exit.void),
    kill: Effect.ignore(kill),
  } satisfies Sidecar;
});

export const startSidecar = Effect.fn("sidecar.start")(function* (options: SidecarOptions) {
  const scope = yield* Scope.make();

  return yield* serve(options, scope).pipe(Effect.onError(() => Scope.close(scope, Exit.void)));
});

export const runCli = Effect.fn("sidecar.runCli")(function* (args: ReadonlyArray<string>) {
  const install = yield* Install;
  const launch = yield* resolveLaunch;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const command = ChildProcess.make(
    launch.command,
    [...launch.args, ...args],
    childOptions(install.homePath, yield* ServerEnv),
  );

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const handle = yield* spawner
        .spawn(command)
        .pipe(Effect.mapError((error) => new SidecarFailed({ message: nodeMessage(error) })));

      const stdout = yield* Ref.make("");

      const output = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText(),
            Stream.runForEach((chunk) => Ref.update(stdout, (text) => text + chunk)),
          ),
          forward(handle.stderr, Console.error),
        ],
        { concurrency: 2, discard: true },
      ).pipe(Effect.ignore, Effect.forkDetach);

      const code: Option.Option<number> = yield* Effect.option(handle.exitCode).pipe(
        Effect.timeoutOrElse({
          duration: CLI_TIMEOUT,
          orElse: () =>
            handle.kill({ killSignal: "SIGKILL" }).pipe(Effect.ignore, Effect.as(Option.none())),
        }),
      );

      // Node can report the exit before the pipes are drained.
      yield* Fiber.await(output);

      return { code, stdout: yield* Ref.get(stdout) };
    }),
  );
});
