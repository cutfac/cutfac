import {
  Context,
  type Crypto,
  Effect,
  type FileSystem,
  Layer,
  Option,
  type Path,
  Queue,
  Ref,
  Semaphore,
} from "effect";
import type { HttpClient } from "effect/http";
import type { ChildProcessSpawner } from "effect/process";

import type { AgentName } from "../src/core/schema.ts";
import { AppState } from "./appState.ts";
import type { PortTaken } from "./ports.ts";
import { loadPort, savePort, type Settings, type SettingsNotSaved } from "./settings.ts";
import {
  Install,
  startSidecar,
  type ServerEnv,
  type Sidecar,
  type SidecarFailed,
} from "./sidecar.ts";

interface Served {
  readonly workspace: string;
  readonly sidecar: Sidecar;
}

export class WorkspaceServer extends Context.Service<
  WorkspaceServer,
  {
    /** Serve `workspace`, making it first with `agent` as its agent when it isn't one yet. */
    serve(
      workspace: string,
      agent?: AgentName,
    ): Effect.Effect<Option.Option<Sidecar>, SidecarFailed | PortTaken | SettingsNotSaved>;
    readonly stop: Effect.Effect<void>;
    readonly kill: Effect.Effect<void>;
    readonly crashes: Queue.Dequeue<string>;
  }
>()("cutfac/desktop/WorkspaceServer") {
  static readonly layer = Layer.effect(
    WorkspaceServer,
    Effect.suspend(() => make),
  );
}

const make = Effect.gen(function* () {
  const { devPort } = yield* Install;
  const { quitting, freeVersionData } = yield* AppState;

  const services = yield* Effect.context<
    | ChildProcessSpawner.ChildProcessSpawner
    | HttpClient.HttpClient
    | FileSystem.FileSystem
    | Path.Path
    | Crypto.Crypto
    | Install
    | ServerEnv
    | Settings
  >();

  const lock = yield* Semaphore.make(1);
  const current = yield* Ref.make(Option.none<Served>());
  const crashes = yield* Queue.unbounded<string>();

  const stopCurrent = Effect.flatMap(
    Ref.getAndSet(current, Option.none()),
    Option.match({ onNone: () => Effect.void, onSome: ({ sidecar }) => sidecar.stop }),
  );

  yield* Effect.addFinalizer(() => stopCurrent);

  const start = Effect.fnUntraced(function* (workspace: string, agent: AgentName | undefined) {
    const sidecar = yield* startSidecar({
      workspace,
      agent,
      env: Option.match(yield* Ref.get(freeVersionData), {
        onNone: () => ({}),
        onSome: (data) => ({ CUTFAC_DESKTOP_DATA: data }),
      }),
      port: Option.isSome(devPort) ? { fixed: devPort.value } : { last: yield* loadPort },
      watch: Option.isSome(devPort),
      onCrash: (message) =>
        Effect.andThen(Ref.set(current, Option.none()), Queue.offer(crashes, message)),
    });

    if (yield* Ref.get(quitting)) {
      yield* sidecar.stop;

      return Option.none<Sidecar>();
    }

    yield* Ref.set(current, Option.some({ workspace, sidecar }));

    if (Option.isNone(devPort)) yield* savePort(sidecar.port);

    return Option.some(sidecar);
  });

  const serve = (workspace: string, agent?: AgentName) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const served = yield* Ref.get(current);

        if (Option.isSome(served) && served.value.workspace === workspace) {
          return Option.some(served.value.sidecar);
        }

        yield* stopCurrent;

        return yield* start(workspace, agent);
      }).pipe(Effect.provideContext(services)),
    );

  const kill = Effect.flatMap(
    Ref.get(current),
    Option.match({ onNone: () => Effect.void, onSome: ({ sidecar }) => sidecar.kill }),
  );

  return WorkspaceServer.of({ serve, stop: lock.withPermits(1)(stopCurrent), kill, crashes });
});
