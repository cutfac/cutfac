import { describe, expect } from "bun:test";
import path from "node:path";

// Each check starts its own servers, with the fake and the environment that check needs.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Deferred, Effect, Fiber, FileSystem, Layer, Option } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import { TestClock, TestConsole } from "effect/testing";

import { bindPort } from "../electron/ports.ts";
import {
  Install,
  runCli,
  ServerEnv,
  startSidecar,
  type SidecarOptions,
} from "../electron/sidecar.ts";
import { testEffect } from "./effect.ts";
import { holdPort } from "./support.ts";

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer));

/**
 * The server's CLI as far as the app uses it, run by Bun: `init`, `serve`, and two commands for
 * `runCli`. FAKE_SIDECAR in its environment picks how `serve` and `init` misbehave.
 */
const FAKE = `
const [command, ...args] = process.argv.slice(2);
const mode = process.env.FAKE_SIDECAR;
const flag = (name) => args[args.indexOf(name) + 1];

if (command === "init") {
  await Bun.write(args[0] + "/init-ran", "");
  if (mode === "setup-fails") {
    console.error("no room");
    process.exit(1);
  }
  await Bun.write(args[0] + "/cutfac.yaml", "");
} else if (command === "env") {
  console.log(JSON.stringify({ cwd: process.cwd(), env: process.env }));
} else if (command === "hang") {
  console.log("partial");
  console.error("waiting");
  setInterval(() => {}, 60_000);
} else if (command === "serve") {
  if (mode === "dies") {
    console.error("boom");
    process.exit(3);
  }
  if (mode === "stubborn") process.on("SIGTERM", () => {});
  if (mode === "silent") setInterval(() => {}, 60_000);
  else Bun.serve({ hostname: flag("--host"), port: Number(flag("--port")), fetch: () => new Response("ok") });
  console.log("starting");
}
`;

/** A folder for the test, with the fake as an executable in it. */
const fakeSidecar = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-sidecar-" });
  const fake = path.join(dir, "fake-sidecar");

  yield* fs.writeFileString(fake, `#!${process.execPath}\n${FAKE}`);
  yield* fs.chmod(fake, 0o755);

  /** A folder in `dir` holding `files`, to serve as a workspace. */
  const folder = Effect.fnUntraced(function* (name: string, files: ReadonlyArray<string> = []) {
    const at = path.join(dir, name);

    yield* fs.makeDirectory(at);
    yield* Effect.forEach(files, (file) => fs.writeFileString(path.join(at, file), ""));

    return at;
  });

  /**
   * Runs `effect` as the app does from a checkout, with CUTFAC_SIDECAR pointing at the fake, and
   * the server's environment telling the fake how to behave.
   */
  const asApp =
    (mode = "") =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.provideService(Install, {
          packaged: false,
          appPath: dir,
          resourcesPath: dir,
          logsPath: dir,
          homePath: dir,
          launchEnv: { CUTFAC_SIDECAR: fake },
        }),
        Effect.provideService(ServerEnv, { FAKE_SIDECAR: mode, SERVER_ONLY: "kept" }),
      );

  /** A server started as the app starts one, stopped when the test ends, whatever happened. */
  const start = (options: SidecarOptions, mode = "") =>
    Effect.acquireRelease(startSidecar(options).pipe(asApp(mode)), (server) => server.stop);

  return { dir, folder, asApp, start };
});

/** Options for a server on `workspace` that ignores a crash, unless the test asks. */
const on = (workspace: string, more: Partial<SidecarOptions> = {}): SidecarOptions => ({
  workspace,
  port: { last: Option.none() },
  watch: false,
  onCrash: () => Effect.void,
  ...more,
});

/** Whether the server at `url` answers at all. */
const answers = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.map((response) => response.status === 200),
    Effect.orElseSucceed(() => false),
  );

/** Waits until the fake has printed `line`, as the app's own output. */
const printed = (lines: Effect.Effect<ReadonlyArray<unknown>>, line: string) =>
  Effect.gen(function* () {
    while (!(yield* lines).includes(`[sidecar] ${line}`)) yield* Effect.promise(() => Bun.sleep(5));
  });

describe("starting the local server", () => {
  it.live("sets a new folder up before serving it, and leaves a workspace by either name", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { folder, start } = yield* fakeSidecar;

      for (const [name, files, setUp] of [
        ["new", [], true],
        ["workspace", ["cutfac.yaml"], false],
        ["before-the-rename", ["factory.yaml"], false],
      ] as const) {
        const workspace = yield* folder(name, files);
        const server = yield* start(on(workspace));

        expect(server.url).toBe(`http://127.0.0.1:${server.port}/`);
        expect(yield* answers(`${server.url}api/health`)).toBe(true);
        expect(yield* fs.exists(path.join(workspace, "init-ran"))).toBe(setUp);

        yield* server.stop;
      }
    }),
  );

  it.live("fails with why it ended before it answered, and the last of what it printed", () =>
    Effect.gen(function* () {
      const { folder, asApp } = yield* fakeSidecar;

      const setUp = yield* startSidecar(on(yield* folder("new"))).pipe(
        asApp("setup-fails"),
        Effect.flip,
      );

      const died = yield* startSidecar(on(yield* folder("workspace", ["cutfac.yaml"]))).pipe(
        asApp("dies"),
        Effect.flip,
      );

      expect(setUp.message).toBe("Workspace setup exited with code 1.\n\nLast output:\nno room");
      expect(died.message).toBe("The local server exited with code 3.\n\nLast output:\nboom");
    }),
  );

  it.live("fails on a fixed port another program holds, instead of taking another", () =>
    Effect.gen(function* () {
      const { folder, asApp } = yield* fakeSidecar;
      const held = yield* bindPort(0);

      yield* holdPort(held);

      const workspace = yield* folder("workspace", ["cutfac.yaml"]);

      const error = yield* startSidecar(on(workspace, { port: { fixed: held } })).pipe(
        asApp(),
        Effect.flip,
      );

      expect(error._tag).toBe("PortTaken");
    }),
  );

  it.effect("stops a server that hasn't answered in 20 seconds, and says so", () =>
    Effect.gen(function* () {
      const { folder, asApp } = yield* fakeSidecar;
      const workspace = yield* folder("workspace", ["cutfac.yaml"]);

      const starting = yield* startSidecar(on(workspace)).pipe(
        asApp("silent"),
        Effect.flip,
        Effect.forkScoped,
      );

      yield* printed(TestConsole.logLines, "starting");
      yield* TestClock.adjust("20 seconds");

      expect((yield* Fiber.join(starting)).message).toBe(
        "The local server did not answer within 20s and was killed by SIGTERM.\n\nLast output:\nstarting",
      );
    }),
  );
});

describe("a running local server", () => {
  it.live("tells the app when it dies on its own, and not when the app stops it", () =>
    Effect.gen(function* () {
      const { folder, start } = yield* fakeSidecar;
      const workspace = yield* folder("workspace", ["cutfac.yaml"]);
      const crashed = yield* Deferred.make<string>();
      const onCrash = (message: string) => Effect.asVoid(Deferred.succeed(crashed, message));

      const stopped = yield* start(on(workspace, { onCrash }));

      yield* stopped.stop;

      const killed = yield* start(on(workspace, { onCrash }));

      yield* killed.kill;

      expect(yield* Deferred.await(crashed)).toBe(
        "The local server was killed by SIGKILL.\n\nLast output:\nstarting",
      );
      expect(yield* answers(killed.url)).toBe(false);
    }),
  );

  it.live(
    "is killed once the grace period is over if it ignores the request to stop",
    () =>
      Effect.gen(function* () {
        const { folder, start } = yield* fakeSidecar;
        const workspace = yield* folder("workspace", ["cutfac.yaml"]);
        const server = yield* start(on(workspace), "stubborn");

        yield* server.stop;

        expect(yield* answers(server.url)).toBe(false);
      }),
    10_000,
  );
});

describe("running a server command", () => {
  it.live("runs it from the home folder, in the server's environment and nothing else", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, asApp } = yield* fakeSidecar;
      const result = yield* runCli(["env"]).pipe(asApp());
      const { cwd, env } = JSON.parse(result.stdout);

      expect(result.code).toEqual(Option.some(0));
      expect(cwd).toBe(yield* fs.realPath(dir));
      expect(env).toMatchObject({ SERVER_ONLY: "kept" });
      // This test runs with HOME set, which the command would see if it inherited the app's.
      expect(env).not.toHaveProperty("HOME");
    }),
  );

  it.effect("kills one that hangs after 30 seconds, keeping what it printed", () =>
    Effect.gen(function* () {
      const { asApp } = yield* fakeSidecar;
      const running = yield* runCli(["hang"]).pipe(asApp(), Effect.forkScoped);

      yield* printed(TestConsole.errorLines, "waiting");
      yield* TestClock.adjust("30 seconds");

      expect(yield* Fiber.join(running)).toEqual({ code: Option.none(), stdout: "partial\n" });
    }),
  );
});
