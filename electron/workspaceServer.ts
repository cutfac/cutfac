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

/**
 * The local server for the open workspace, one at a time. The first launch starts it before the
 * board shows its workspace, and opening that workspace then keeps it.
 */
export class WorkspaceServer extends Context.Service<
  WorkspaceServer,
  {
    /** The server on `workspace`, started unless it runs there already; none if the app quits. */
    serve(
      workspace: string,
    ): Effect.Effect<Option.Option<Sidecar>, SidecarFailed | PortTaken | SettingsNotSaved>;
    readonly stop: Effect.Effect<void>;
    /** SIGKILL at once, for the process-exit hook. */
    readonly kill: Effect.Effect<void>;
    /** Why each server that stopped on its own did. */
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
  const { quitting } = yield* AppState;

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

  const start = Effect.fnUntraced(function* (workspace: string) {
    const sidecar = yield* startSidecar({
      workspace,
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

  const serve = (workspace: string) =>
    lock.withPermits(1)(
      Effect.gen(function* () {
        const served = yield* Ref.get(current);

        if (Option.isSome(served) && served.value.workspace === workspace) {
          return Option.some(served.value.sidecar);
        }

        yield* stopCurrent;

        return yield* start(workspace);
      }).pipe(Effect.provideContext(services)),
    );

  const kill = Effect.flatMap(
    Ref.get(current),
    Option.match({ onNone: () => Effect.void, onSome: ({ sidecar }) => sidecar.kill }),
  );

  return WorkspaceServer.of({ serve, stop: lock.withPermits(1)(stopCurrent), kill, crashes });
});
