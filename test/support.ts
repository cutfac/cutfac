import { generateKeyPairSync, sign } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Each helper runs a test's effect to completion, so it is the entry point that provides layers.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, FileSystem, Layer, Option, type Schema } from "effect";

import { which } from "../src/core/process.ts";
import { Workspace } from "../src/core/workspace.ts";
import { LicensePublicKey } from "../src/license.ts";

/** What a core effect may need in tests: the workspace and the Bun platform services. */
export type TestServices = Workspace | BunServices.BunServices;

export interface TestWorkspace {
  readonly root: string;
  /** Run an effect against this workspace, rejecting with the effect's error. */
  readonly run: <A, E>(effect: Effect.Effect<A, E, TestServices>) => Promise<A>;
  /** Run an effect that also needs `extra`, such as a fake HTTP client. */
  readonly runWith: <A, E, R>(
    extra: Layer.Layer<R>,
    effect: Effect.Effect<A, E, R | TestServices>,
  ) => Promise<A>;
  /** Run an effect that is expected to fail, resolving with its error. */
  readonly fail: <A, E>(effect: Effect.Effect<A, E, TestServices>) => Promise<E>;
  readonly layer: Layer.Layer<TestServices>;
  readonly remove: () => Promise<void>;
}

/** A fresh folder with a cutfac.yaml, removed by `remove`. */
export async function makeWorkspace(name = "test"): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), "cutfac-test-"));
  await writeFile(join(root, "cutfac.yaml"), `name: ${name}\n`);

  const layer = Workspace.layer(root).pipe(Layer.provideMerge(BunServices.layer), Layer.orDie);

  return {
    root,
    layer,
    run: (effect) => Effect.runPromise(Effect.provide(effect, layer)),
    runWith: (extra, effect) =>
      Effect.runPromise(Effect.provide(effect, Layer.merge(layer, extra))),
    fail: (effect) => Effect.runPromise(Effect.provide(Effect.flip(effect), layer)),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

/** A fresh folder with a cutfac.yaml as the workspace, removed when the test ends. */
export const tempWorkspace = (name = "test") =>
  Layer.unwrap(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-test-" });

      yield* fs.writeFileString(join(root, "cutfac.yaml"), `name: ${name}\n`);

      return Workspace.layer(root);
    }),
  ).pipe(Layer.provideMerge(BunServices.layer), Layer.orDie);

export interface FakeAgents {
  readonly dir: string;
  /** Where a fake can record what it was given: `calls` in `dir`. */
  readonly calls: string;
  /** A PATH of only the fakes, for wherever an agent CLI is looked up. */
  readonly layer: Layer.Layer<never>;
  /** Put an executable `name` on that PATH that runs `script` with sh. */
  readonly bin: (name: string, script: string) => Promise<string>;
  readonly remove: () => Promise<void>;
}

/**
 * A folder of fake agent CLIs and a PATH of only them, so a real `claude` or `codex` on this
 * machine is never found or run. Throws if one still is.
 */
export async function makeFakeAgents(): Promise<FakeAgents> {
  const dir = await mkdtemp(join(tmpdir(), "cutfac-fake-agent-"));
  const calls = join(dir, "calls");
  await mkdir(join(dir, "bin"));
  await mkdir(calls);

  const layer = ConfigProvider.layer(ConfigProvider.fromEnv({ env: { PATH: join(dir, "bin") } }));
  const remove = () => rm(dir, { recursive: true, force: true });

  const found = Effect.forEach(["claude", "codex"], which).pipe(
    Effect.provide([layer, BunServices.layer]),
  );

  if ((await Effect.runPromise(found)).some(Option.isSome)) {
    await remove();
    throw new Error("A real agent CLI is still on PATH; the tests must only run fakes");
  }

  const bin = async (name: string, script: string) => {
    const path = join(dir, "bin", name);
    await writeFile(path, `#!/bin/sh\nPATH=/bin:/usr/bin\n${script}`);
    await chmod(path, 0o755);

    return path;
  };

  return { dir, calls, layer, bin, remove };
}

/** Listens on `port` on loopback until the scope closes, as another program holding it would. */
export const holdPort = (port: number) =>
  Effect.acquireRelease(
    Effect.callback<Server>((resume) => {
      const server = createServer();

      server.listen(port, "127.0.0.1", () => resume(Effect.succeed(server)));
    }),
    (server) => Effect.callback<void>((resume) => void server.close(() => resume(Effect.void))),
  );

/** Whether process `pid` is still there. */
export const alive = (pid: number) =>
  Effect.try(() => process.kill(pid, 0)).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  );

/** Kills process `pid` when the test ends, if it is still there then. */
export const killedAfter = (pid: number) =>
  Effect.addFinalizer(() => Effect.ignore(Effect.try(() => process.kill(pid, "SIGKILL"))));

/** A key pair to sign license grants with, as cutfac.com does, made for each run. */
export const licenseSigning = generateKeyPairSync("ed25519");

/** A grant's token for `key`, signed with `licenseSigning` as cutfac.com signs one. */
export function signedGrant(
  checkedAt: number,
  expiresAt: number | null = null,
  key = "KEY-1",
  { privateKey } = licenseSigning,
): string {
  const payload = Buffer.from(JSON.stringify({ key, checkedAt, expiresAt }));

  return `${payload.toString("base64url")}.${sign(null, payload, privateKey).toString("base64url")}`;
}

/** Checks license grants against `licenseSigning`, so the tests' own grants unlock the plan. */
export const testLicenseKey = Layer.succeed(LicensePublicKey, licenseSigning.publicKey);

/** The thread a fake `codex app-server` starts, or resumes. */
export const FAKE_THREAD = "0f9d3c1e-8b2a-4c5d-9e6f-7a8b9c0d1e2f";

/** A line a fake Codex writes on its own thread's turn: an item done, as `item/completed`. */
export const codexItem = (item: Schema.JsonObject) =>
  `echo '${JSON.stringify({ method: "item/completed", params: { threadId: FAKE_THREAD, turnId: "turn-1", item } })}'`;

/** A fake Codex's answer to the run's request `id`. */
const answered = (id: number, result: Schema.JsonObject) =>
  `echo '${JSON.stringify({ id, result })}'`;

/**
 * A script for a fake `codex app-server`: it keeps its arguments in `calls/args` and every line it
 * reads in `calls/stdin`, answers the handshake, runs `turn` (shell, which may write lines and
 * `read -r` the answers) once the turn starts, and then completes the turn.
 */
export function codexAppServer(calls: string, turn = "", status = "completed"): string {
  const done = { threadId: FAKE_THREAD, turn: { id: "turn-1", status } };

  return `[ "$1" = mcp ] && { echo '[]'; exit 0; }
[ "$1" = app-server ] || exit 0
printf '%s\\0' "$@" > "${calls}/args"
while IFS= read -r line; do
  printf '%s\\n' "$line" >> "${calls}/stdin"
  case "$line" in
    *'"method":"initialize"'*) ${answered(1, {})} ;;
    *'"method":"thread/'*) ${answered(2, { thread: { id: FAKE_THREAD } })} ;;
    *'"method":"turn/start"'*)
      ${answered(3, { turn: { id: "turn-1", status: "inProgress" } })}
      ${turn}
      echo '${JSON.stringify({ method: "turn/completed", params: done })}' ;;
  esac
done
`;
}

/** A line a fake `codex app-server` read: a request or notification of the run's, or an answer. */
export interface CodexReceived {
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: Schema.JsonObject;
  readonly result?: Schema.Json;
}

/** The messages a fake `codex app-server` read, in order. */
export const codexReceived = async (calls: string): Promise<ReadonlyArray<CodexReceived>> =>
  (await readFile(join(calls, "stdin"), "utf8"))
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));

/** The params of the first message with `method` that a fake Codex read. */
export const codexParams = (received: ReadonlyArray<CodexReceived> = [], method: string) =>
  received.find((message) => message.method === method)?.params;
