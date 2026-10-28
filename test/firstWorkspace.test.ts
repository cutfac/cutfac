import { describe, expect } from "bun:test";
import path from "node:path";

// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Effect, Fiber, FileSystem, Layer, Option, Predicate, Queue, Ref, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { FirstWorkspace, type FirstWorkspaceInput } from "../electron/firstWorkspace.ts";
import type { Sidecar } from "../electron/sidecar.ts";
import { WorkspaceServer } from "../electron/workspaceServer.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

const URL_BASE = "http://127.0.0.1:4317/";

const decodeBody = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

interface Api {
  readonly calls: ReadonlyArray<string>;
  readonly learned: ReadonlyArray<{ readonly source: string; readonly unread: boolean }>;
  readonly reading: boolean;
}

const fakeApi = (api: Ref.Ref<Api>) =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      yield* Effect.sleep("1 millis");

      const body = Predicate.isTagged(request.body, "Uint8Array")
        ? yield* Effect.orDie(decodeBody(new TextDecoder().decode(request.body.body)))
        : null;

      const call = `${request.method} ${url.pathname}${body === null ? "" : ` ${JSON.stringify(body)}`}`;

      const state = yield* Ref.updateAndGet(api, (now) => ({
        ...now,
        calls: [...now.calls, call],
      }));

      const json = (value: Schema.Json) =>
        HttpClientResponse.fromWeb(request, Response.json(value));

      if (request.method === "POST" && url.pathname === "/api/learn") {
        const source = Predicate.hasProperty(body, "source") ? String(body.source) : "";

        yield* Ref.update(api, (now) => ({
          ...now,
          learned: [...now.learned, { source, unread: true }],
        }));
      }

      if (request.method === "GET" && url.pathname === "/api/learned") {
        return json({
          learned: state.learned.map(({ source, unread }) => ({
            doc: { source: { url: source } },
            unread,
          })),
        });
      }

      if (request.method === "GET" && url.pathname === "/api/imports") {
        return json(
          state.reading ? [{ doc: { kind: "learn", closed: false }, running: true }] : [],
        );
      }

      return json({});
    }),
  );

const alwaysServing = Effect.gen(function* () {
  const crashes = yield* Queue.unbounded<string>();

  const sidecar: Sidecar = {
    url: URL_BASE,
    port: 4317,
    stop: Effect.void,
    kill: Effect.void,
  };

  return WorkspaceServer.of({
    serve: () => Effect.succeedSome(sidecar),
    stop: Effect.void,
    kill: Effect.void,
    crashes,
  });
});

const firstWorkspaceWith = (api: Ref.Ref<Api>) =>
  FirstWorkspace.layer.pipe(
    Layer.provide([
      Layer.effect(WorkspaceServer, alwaysServing),
      Layer.succeed(HttpClient.HttpClient, fakeApi(api)),
    ]),
  );

const answers = (library: string, sources: ReadonlyArray<string>): FirstWorkspaceInput => ({
  library,
  name: "Recipes",
  draft: {
    brief: { purpose: null, platforms: ["shorts"], body: " Quick dinners " },
    sources: [...sources],
  },
  agents: Effect.succeed([{ agent: "claude", state: "ready" }]),
  locale: "ko",
  picked: Option.none(),
});

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const library = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-first-" });
  const api = yield* Ref.make<Api>({ calls: [], learned: [], reading: false });

  return { library, api };
});

describe("the first workspace", () => {
  it.live("is made in the app's folder, its brief saved, its sources learned and read", () =>
    Effect.gen(function* () {
      const { library, api } = yield* setup;

      const made = yield* Effect.flatMap(FirstWorkspace, (first) =>
        first.start(answers(library, ["https://example.com/a", " ", "https://example.com/a "])),
      ).pipe(Effect.provide(firstWorkspaceWith(api)));

      expect(made).toBe(path.join(library, "workspaces", "Recipes"));
      expect((yield* Ref.get(api)).calls).toEqual([
        'PATCH /api/brief {"platforms":["shorts"],"body":"Quick dinners"}',
        "GET /api/learned",
        'POST /api/learn {"source":"https://example.com/a"}',
        "GET /api/learned",
        "GET /api/imports",
        'POST /api/imports {"kind":"learn","agent":"claude","locale":"ko"}',
      ]);
    }),
  );

  it.live("adds only what is new when answered again, and starts no second reading", () =>
    Effect.gen(function* () {
      const { library, api } = yield* setup;

      yield* Effect.gen(function* () {
        const first = yield* FirstWorkspace;

        yield* first.start(answers(library, ["https://example.com/a"]));
        yield* Ref.update(api, (now) => ({ ...now, calls: [], reading: true }));
        yield* first.start(answers(library, ["https://example.com/a", "https://example.com/b"]));
      }).pipe(Effect.provide(firstWorkspaceWith(api)));

      const { calls } = yield* Ref.get(api);

      expect(calls.filter((call) => call.startsWith("POST"))).toEqual([
        'POST /api/learn {"source":"https://example.com/b"}',
      ]);
    }),
  );

  it.live(
    "waits for the run before when answered again meanwhile, so nothing is learned twice",
    () =>
      Effect.gen(function* () {
        const { library, api } = yield* setup;
        const sources = ["https://example.com/a"];

        yield* Effect.flatMap(FirstWorkspace, (first) =>
          Effect.all(
            [first.start(answers(library, sources)), first.start(answers(library, sources))],
            {
              concurrency: "unbounded",
            },
          ),
        ).pipe(Effect.provide(firstWorkspaceWith(api)));

        const { calls } = yield* Ref.get(api);

        expect(calls.filter((call) => call.startsWith("POST /api/learn"))).toHaveLength(1);
      }),
  );

  it.live("is ready once the latest run is done, and none before or after one that failed", () =>
    Effect.gen(function* () {
      const { library, api } = yield* setup;

      yield* Effect.gen(function* () {
        const first = yield* FirstWorkspace;

        expect(yield* first.ready).toEqual(Option.none());

        const started = yield* Effect.forkChild(first.start(answers(library, [])), {
          startImmediately: true,
        });

        expect(yield* first.ready).toEqual(
          Option.some(path.join(library, "workspaces", "Recipes")),
        );
        yield* Fiber.join(started);

        yield* Effect.flip(first.start({ ...answers(library, []), library: "/dev/null/nowhere" }));

        expect(yield* first.ready).toEqual(Option.none());
      }).pipe(Effect.provide(firstWorkspaceWith(api)));
    }),
  );
});
