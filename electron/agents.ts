import { stripVTControlCharacters } from "node:util";

import {
  Context,
  type Crypto,
  Effect,
  Fiber,
  type FileSystem,
  Layer,
  Option,
  type Path,
  Ref,
  Schema,
  Stream,
  SynchronizedRef,
} from "effect";
import type { HttpClient } from "effect/http";
import type { PlatformError } from "effect/PlatformError";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { AgentSetupJson, type AgentSetup } from "../src/core/agentReadiness.ts";
import type { AgentName } from "../src/core/schema.ts";
import type { AgentFix } from "../web/src/desktop.ts";
import { Install, runCli, ServerEnv, type SidecarFailed } from "./sidecar.ts";

/** A sign-in waits on the user's browser; one left that long is given up on. */
const FIX_TIMEOUT = "10 minutes";

const decodeSetups = Schema.decodeUnknownOption(AgentSetupJson);

export class AgentCheckFailed extends Schema.TaggedError<AgentCheckFailed>()("AgentCheckFailed", {
  message: Schema.String,
}) {}

export class NothingToFix extends Schema.TaggedError<NothingToFix>()("NothingToFix", {
  message: Schema.String,
}) {}

export class AgentFixes extends Context.Service<
  AgentFixes,
  {
    readonly check: Effect.Effect<ReadonlyArray<AgentSetup>, AgentCheckFailed | SidecarFailed>;
    fix(
      agent: AgentName,
      onLine: (line: string) => Effect.Effect<void>,
    ): Effect.Effect<AgentFix, NothingToFix>;
    readonly stopAll: Effect.Effect<void>;
  }
>()("cutfac/desktop/AgentFixes") {
  static readonly layer = Layer.effect(
    AgentFixes,
    Effect.suspend(() => make),
  );
}

const make = Effect.gen(function* () {
  const services = yield* Effect.context<
    | ChildProcessSpawner.ChildProcessSpawner
    | HttpClient.HttpClient
    | FileSystem.FileSystem
    | Path.Path
    | Crypto.Crypto
    | Install
    | ServerEnv
  >();

  const known = yield* Ref.make<ReadonlyMap<AgentName, string>>(new Map());

  const running = yield* SynchronizedRef.make<ReadonlyMap<AgentName, Fiber.Fiber<AgentFix>>>(
    new Map(),
  );

  const groups = yield* Ref.make<ReadonlySet<number>>(new Set());
  const scope = yield* Effect.scope;

  const check = Effect.gen(function* () {
    const { stdout } = yield* runCli(["agents", "--json"]);
    const setups = decodeSetups(stdout.trim());

    if (Option.isNone(setups)) {
      return yield* new AgentCheckFailed({
        message: "Could not check the agents on this computer",
      });
    }

    yield* Ref.set(
      known,
      new Map(setups.value.flatMap((setup) => (setup.fix ? [[setup.agent, setup.fix]] : []))),
    );

    return setups.value;
  }).pipe(Effect.provideContext(services));

  const printed = (
    stream: Stream.Stream<Uint8Array, PlatformError>,
    onLine: (line: string) => Effect.Effect<void>,
  ) =>
    stream.pipe(
      Stream.decodeText(),
      // Installers redraw their progress with carriage returns, which end a line here too.
      Stream.splitLines,
      Stream.map((line) => stripVTControlCharacters(line).trim()),
      Stream.filter((line) => line !== ""),
      Stream.runForEach(onLine),
    );

  const runFix = (command: string, onLine: (line: string) => Effect.Effect<void>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const { homePath } = yield* Install;

        const handle = yield* spawner.spawn(
          ChildProcess.make("/bin/sh", ["-c", command], {
            cwd: homePath,
            env: yield* ServerEnv,
            extendEnv: false,
            stdin: "ignore",
            detached: true,
            killSignal: "SIGKILL",
          }),
        );

        yield* Effect.acquireRelease(
          Ref.update(groups, (pids) => new Set([...pids, handle.pid])),
          () =>
            Ref.update(groups, (pids) => new Set([...pids].filter((pid) => pid !== handle.pid))),
        );

        const output = yield* Effect.all(
          [printed(handle.stdout, onLine), printed(handle.stderr, onLine)],
          { concurrency: 2, discard: true },
        ).pipe(Effect.ignore, Effect.forkScoped);

        const code = yield* handle.exitCode;

        yield* Fiber.await(output);

        return code === 0;
      }),
    ).pipe(
      Effect.timeoutOrElse({ duration: FIX_TIMEOUT, orElse: () => Effect.succeed(false) }),
      Effect.orElseSucceed(() => false),
      Effect.map((ok): AgentFix => ({ ok, command })),
      Effect.provideContext(services),
    );

  const fix = (agent: AgentName, onLine: (line: string) => Effect.Effect<void>) =>
    Effect.gen(function* () {
      const command = (yield* Ref.get(known)).get(agent);

      if (command === undefined) {
        return yield* new NothingToFix({ message: `Nothing to fix for ${agent}` });
      }

      const fiber = yield* SynchronizedRef.modifyEffect(running, (fixing) => {
        const current = fixing.get(agent);

        if (current !== undefined) return Effect.succeed([current, fixing] as const);

        return runFix(command, onLine).pipe(
          Effect.ensuring(
            SynchronizedRef.update(running, (now) => {
              const rest = new Map(now);

              rest.delete(agent);

              return rest;
            }),
          ),
          Effect.forkIn(scope),
          Effect.map((started) => [started, new Map([...fixing, [agent, started]])] as const),
        );
      });

      return yield* Fiber.join(fiber);
    });

  const stopAll = Effect.flatMap(Ref.get(groups), (pids) =>
    Effect.forEach(pids, (pid) => Effect.ignore(Effect.try(() => process.kill(-pid, "SIGKILL"))), {
      discard: true,
    }),
  );

  return AgentFixes.of({ check, fix, stopAll });
});
