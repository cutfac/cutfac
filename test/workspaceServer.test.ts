import { describe, expect } from "bun:test";
import path from "node:path";

// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Effect, FileSystem, Layer, Option, Queue, Ref } from "effect";
import { FetchHttpClient } from "effect/http";

import { AppState } from "../electron/appState.ts";
import { bindPort } from "../electron/ports.ts";
import { loadPort, Settings } from "../electron/settings.ts";
import { Install, ServerEnv } from "../electron/sidecar.ts";
import { WorkspaceServer } from "../electron/workspaceServer.ts";
import { testEffect } from "./effect.ts";
import { answers, fakeSidecar } from "./fakeSidecar.ts";

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer));

const serverFor = (dir: string, fake: string, devPort: Option.Option<number> = Option.none()) =>
  WorkspaceServer.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        AppState.layer,
        Settings.layer({ dir, defaultLibrary: dir }),
        Layer.succeed(
          Install,
          Install.of({
            packaged: false,
            appPath: dir,
            resourcesPath: dir,
            logsPath: dir,
            homePath: dir,
            launchEnv: { CUTFAC_SIDECAR: fake },
            devPort,
          }),
        ),
        Layer.succeed(ServerEnv, {}),
      ),
    ),
  );

const served = (workspace: string) =>
  Effect.flatMap(WorkspaceServer, (server) =>
    Effect.map(server.serve(workspace), Option.getOrThrow),
  );

const stoppedIn = (workspace: string) =>
  Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(path.join(workspace, "stopped")));

describe("the workspace's server", () => {
  it.live("keeps the server when the workspace it serves is opened again", () =>
    Effect.gen(function* () {
      const { dir, fake, folder } = yield* fakeSidecar;
      const workspace = yield* folder("a", ["cutfac.yaml"]);

      yield* Effect.gen(function* () {
        const first = yield* served(workspace);

        expect(yield* served(workspace)).toBe(first);
        expect(yield* answers(first.url)).toBe(true);
      }).pipe(Effect.provide(serverFor(dir, fake)));
    }),
  );

  it.live("stops the server it had before serving another workspace", () =>
    Effect.gen(function* () {
      const { dir, fake, folder } = yield* fakeSidecar;
      const a = yield* folder("a", ["cutfac.yaml"]);
      const b = yield* folder("b", ["cutfac.yaml"]);

      yield* Effect.gen(function* () {
        yield* served(a);

        const next = yield* served(b);

        expect(yield* stoppedIn(a)).toBe(true);
        expect(yield* answers(next.url)).toBe(true);
      }).pipe(Effect.provide(serverFor(dir, fake)));
    }),
  );

  it.live("forgets a server that died, says why, and starts it again when asked", () =>
    Effect.gen(function* () {
      const { dir, fake, folder } = yield* fakeSidecar;
      const workspace = yield* folder("a", ["cutfac.yaml"]);

      yield* Effect.gen(function* () {
        const server = yield* WorkspaceServer;
        const first = yield* served(workspace);

        yield* server.kill;

        expect(yield* Queue.take(server.crashes)).toStartWith(
          "The local server was killed by SIGKILL.",
        );

        const second = yield* served(workspace);

        expect(second).not.toBe(first);
        expect(yield* answers(second.url)).toBe(true);
      }).pipe(Effect.provide(serverFor(dir, fake)));
    }),
  );

  it.live("stops a server that finishes starting as the app quits, rather than serve it", () =>
    Effect.gen(function* () {
      const { dir, fake, folder } = yield* fakeSidecar;
      const workspace = yield* folder("a", ["cutfac.yaml"]);

      yield* Effect.gen(function* () {
        const { quitting } = yield* AppState;
        const server = yield* WorkspaceServer;

        yield* Ref.set(quitting, true);

        expect(yield* server.serve(workspace)).toEqual(Option.none());
        expect(yield* stoppedIn(workspace)).toBe(true);
      }).pipe(Effect.provide(serverFor(dir, fake)));
    }),
  );

  it.live("keeps the port for next time, except on the dev runner's fixed one", () =>
    Effect.gen(function* () {
      const { dir, fake, folder } = yield* fakeSidecar;
      const workspace = yield* folder("a", ["cutfac.yaml"]);
      const fixed = yield* bindPort(0);

      const packaged = yield* Effect.gen(function* () {
        const sidecar = yield* served(workspace);

        return { port: sidecar.port, saved: yield* loadPort };
      }).pipe(Effect.provide(serverFor(path.join(dir, "packaged"), fake)));

      expect(packaged.saved).toEqual(Option.some(packaged.port));

      const dev = yield* Effect.gen(function* () {
        const sidecar = yield* served(workspace);

        return { port: sidecar.port, saved: yield* loadPort };
      }).pipe(Effect.provide(serverFor(path.join(dir, "dev"), fake, Option.some(fixed))));

      expect(dev).toEqual({ port: fixed, saved: Option.none() });
    }),
  );
});
