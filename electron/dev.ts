/**
 * `bun run desktop:dev`: the desktop app on live code. Vite serves the board with hot reload, the
 * server restarts itself when src/ changes, and the app restarts when electron/ changes, or only
 * reloads its page when the preload script alone did. Closing the app or Ctrl+C stops everything.
 */
import path from "node:path";

// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import {
  Cause,
  Config,
  Console,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Option,
  Ref,
  Schedule,
  Scope,
  Stream,
} from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { DEV_APP, devElectron } from "./devApp.ts";
import { DEV_ENV } from "./devEnv.ts";
import { type AppProcess, launchApp } from "./devLaunch.ts";
import { bindPort, freePort } from "./ports.ts";
import { scriptLog } from "./script.ts";

const root = path.resolve(import.meta.dir, "..");

const VITE_READY = "30 seconds";

const VITE_POLL = "150 millis";

const RESTART_DEBOUNCE = "300 millis";

const bin = (name: string) => path.join(root, "node_modules", ".bin", name);

const log = scriptLog("desktop:dev");

const DEV_SCRIPTS = new Set([path.basename(import.meta.path), "devApp.ts", "devLaunch.ts"]);

const reloadsPage = (files: ReadonlySet<string>) =>
  process.platform !== "win32" && [...files].every((file) => file === "preload.ts");

interface Running {
  readonly app: AppProcess;
  readonly scope: Scope.Closeable;
}

const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const fs = yield* FileSystem.FileSystem;

  const stopped = yield* Deferred.make<number>();
  const stop = (code: number) => Deferred.succeed(stopped, code);

  const runSync = Effect.runSyncWith(yield* Effect.context<never>());

  for (const [name, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    // The terminal closed. The app runs apart from this script on macOS, so it would outlive it.
    ["SIGHUP", 129],
  ] as const) {
    process.on(name, () => runSync(stop(code)));
  }

  const serverPort = yield* Option.match(yield* Config.option(Config.Port(DEV_ENV.serverPort)), {
    onNone: () => freePort(Option.none()),
    onSome: Effect.succeed,
  });

  const vitePort = yield* freePort(Option.none()).pipe(
    Effect.repeat({ until: (port) => port !== serverPort }),
  );

  const devUrl = `http://localhost:${vitePort}`;

  const cdpPort = yield* bindPort(9222).pipe(Effect.catch(() => freePort(Option.none())));

  const appEnv = { [DEV_ENV.serverPort]: String(serverPort), [DEV_ENV.url]: devUrl };

  const spawnLogged = (command: string, args: ReadonlyArray<string>) =>
    spawner.spawn(
      ChildProcess.make(command, args, {
        cwd: root,
        env: appEnv,
        extendEnv: true,
        stdin: "ignore",
        stdout: "inherit",
        stderr: "inherit",
      }),
    );

  const vite = yield* spawnLogged(bin("vite"), ["--port", String(vitePort), "--strictPort"]);

  yield* vite.exitCode.pipe(
    Effect.exit,
    Effect.flatMap((exit) =>
      log(`Vite exited with code ${Exit.isSuccess(exit) ? exit.value : "unknown"}.`),
    ),
    Effect.andThen(stop(1)),
    Effect.forkScoped,
  );

  const buildElectron = Effect.scoped(
    spawnLogged("bun", ["run", "build:electron"]).pipe(
      Effect.flatMap((build) => build.exitCode),
      Effect.map((code) => code === 0),
      Effect.orElseSucceed(() => false),
    ),
  );

  const electronExecutable =
    process.platform === "darwin"
      ? devElectron(root).pipe(
          Effect.catch((error) =>
            Effect.as(
              log(`Could not set up ${DEV_APP.name}, running stock Electron: ${error.message}`),
              bin("electron"),
            ),
          ),
        )
      : Effect.succeed(bin("electron"));

  const executable = yield* Effect.forkScoped(electronExecutable);

  const running = yield* Ref.make(Option.none<Running>());

  const isRunning = (app: AppProcess) =>
    Effect.map(
      Ref.get(running),
      Option.exists((now) => now.app === app),
    );

  const stopApp = Effect.flatMap(Ref.getAndSet(running, Option.none()), (previous) =>
    Option.match(previous, {
      onNone: () => Effect.void,
      // The app holds a single-instance lock and the server port until it has quit.
      onSome: ({ scope }) => Scope.close(scope, Exit.void),
    }),
  );

  yield* Effect.addFinalizer(() => stopApp);

  const launch = (again: boolean) =>
    Effect.gen(function* () {
      const scope = yield* Scope.make();

      const app = yield* launchApp({
        executable: yield* Fiber.join(executable),
        root,
        args: [`--remote-debugging-port=${cdpPort}`],
        env: again ? { ...appEnv, [DEV_ENV.restart]: "1" } : appEnv,
        background: again,
      }).pipe(Scope.provide(scope));

      yield* Ref.set(running, Option.some({ app, scope }));

      yield* app.pid.pipe(
        Effect.flatMap((pid) =>
          Effect.flatMap(isRunning(app), (current) =>
            Option.isNone(pid) && current
              ? log(`Could not find ${DEV_APP.name} to restart it.`)
              : Effect.void,
          ),
        ),
        Effect.forkScoped,
      );

      yield* app.exited.pipe(
        Effect.flatMap((code) =>
          Effect.flatMap(isRunning(app), (current) => (current ? stop(code) : Effect.void)),
        ),
        Effect.forkScoped,
      );
    });

  const restart = Effect.gen(function* () {
    yield* log("electron/ changed, rebuilding.");

    if (!(yield* buildElectron)) return;

    yield* stopApp;
    yield* launch(true);
  });

  const reloadPage = Effect.gen(function* () {
    yield* log("electron/preload.ts changed, rebuilding and reloading the page.");

    if (!(yield* buildElectron)) return;

    yield* Option.match(yield* Ref.get(running), {
      onNone: () => Effect.void,
      onSome: ({ app }) => app.kill("SIGUSR2"),
    });
  });

  const changed = yield* Ref.make<ReadonlySet<string>>(new Set());

  const start = Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;

    const answers = client.get(devUrl).pipe(
      Effect.timeout("1 second"),
      Effect.map((response) => response.status >= 200 && response.status < 300),
      Effect.orElseSucceed(() => false),
    );

    const ready = yield* answers.pipe(
      Effect.repeat({ schedule: Schedule.spaced(VITE_POLL), until: (up) => up }),
      Effect.timeoutOption(VITE_READY),
    );

    if (Option.isNone(ready)) {
      yield* log(`Vite did not answer on ${devUrl} within 30s.`);

      return yield* stop(1);
    }

    if (!(yield* buildElectron)) return yield* stop(1);

    yield* log(
      `Board on ${devUrl}, server on port ${serverPort}, DevTools Protocol on port ${cdpPort}.`,
    );
    yield* launch(false);

    yield* fs.watch(path.join(root, "electron"), { recursive: true }).pipe(
      Stream.map((event) => event.path),
      Stream.filter((file) => file.endsWith(".ts") && !DEV_SCRIPTS.has(file)),
      Stream.tap((file) => Ref.update(changed, (files) => new Set([...files, file]))),
      Stream.debounce(RESTART_DEBOUNCE),
      Stream.runForEach(() =>
        Effect.flatMap(Ref.getAndSet(changed, new Set()), (files) =>
          reloadsPage(files) ? reloadPage : restart,
        ),
      ),
    );
  });

  yield* Effect.forkScoped(start);

  return yield* Deferred.await(stopped);
}).pipe(Effect.scoped);

const code = await Effect.runPromise(
  program.pipe(
    Effect.provide([BunServices.layer, FetchHttpClient.layer]),
    Effect.catchCause((cause) =>
      Effect.as(Console.error(`[desktop:dev] ${Cause.pretty(cause)}`), 1),
    ),
  ),
);

process.exit(code);
