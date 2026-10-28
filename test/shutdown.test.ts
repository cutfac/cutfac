import { expect } from "bun:test";

import { Context, Effect, Layer, ManagedRuntime } from "effect";

import { shutDown } from "../electron/shutdown.ts";
import { it } from "./effect.ts";

class Server extends Context.Service<Server, { readonly port: number }>()("test/Server") {}

it.live("quitting saves first, then stops what the services opened, running work included", () =>
  Effect.gen(function* () {
    const events: Array<string> = [];
    const record = (event: string) => Effect.sync(() => void events.push(event));

    const server = Layer.effect(
      Server,
      Effect.as(
        Effect.addFinalizer(() => record("server stopped")),
        Server.of({ port: 4318 }),
      ),
    );

    const fixRunning = Layer.effectDiscard(
      Effect.forkScoped(Effect.onInterrupt(Effect.never, () => record("fix stopped"))),
    );

    const runtime = ManagedRuntime.make(Layer.merge(server, fixRunning));
    const save = Effect.andThen(Effect.sleep("10 millis"), record("settings saved"));

    yield* Effect.promise(() =>
      runtime.runPromise(Effect.andThen(shutDown(runtime, save), record("quit"))),
    );

    expect(events[0]).toBe("settings saved");
    expect(events.slice(1, -1).toSorted()).toEqual(["fix stopped", "server stopped"]);
    expect(events.at(-1)).toBe("quit");
  }),
);
