import path from "node:path";

import { Effect, FileSystem, Option } from "effect";
import { HttpClient } from "effect/http";

import { Install, ServerEnv, startSidecar, type SidecarOptions } from "../electron/sidecar.ts";
import { eventually } from "./effect.ts";

/**
 * The server's CLI as far as the app uses it, run by Bun: `init`, `serve`, and the commands
 * `runCli` runs. FAKE_SIDECAR in its environment picks how `serve` and `init` misbehave; left out, a
 * server asked to stop leaves `stopped` in its workspace.
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
} else if (command === "agents") {
  console.log(process.env.FAKE_AGENTS ?? "not json");
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
  if (!mode) {
    process.on("SIGTERM", async () => {
      await Bun.write(flag("--workspace") + "/stopped", "");
      process.exit(0);
    });
  }
  if (mode === "silent") setInterval(() => {}, 60_000);
  else Bun.serve({ hostname: flag("--host"), port: Number(flag("--port")), fetch: () => new Response("ok") });
  console.log("starting");
}
`;

/** A folder for the test, with the fake as an executable in it. */
export const fakeSidecar = Effect.gen(function* () {
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
          devPort: Option.none(),
        }),
        Effect.provideService(ServerEnv, { FAKE_SIDECAR: mode, SERVER_ONLY: "kept" }),
      );

  /** A server started as the app starts one, stopped when the test ends, whatever happened. */
  const start = (options: SidecarOptions, mode = "") =>
    Effect.acquireRelease(startSidecar(options).pipe(asApp(mode)), (server) => server.stop);

  return { dir, fake, folder, asApp, start };
});

/** Whether the server at `url` answers at all. */
export const answers = (url: string) =>
  HttpClient.get(url).pipe(
    Effect.map((response) => response.status === 200),
    Effect.orElseSucceed(() => false),
  );

/** Waits until the fake has printed `line`, as the app's own output. */
export const printed = (lines: Effect.Effect<ReadonlyArray<unknown>>, line: string) =>
  eventually(Effect.map(lines, (all) => all.includes(`[sidecar] ${line}`)));
