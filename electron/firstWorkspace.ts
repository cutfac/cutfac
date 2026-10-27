import {
  Context,
  type Crypto,
  Deferred,
  Effect,
  type FileSystem,
  Layer,
  Option,
  type Path,
  Ref,
  Schema,
  Semaphore,
} from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type { AgentName } from "../src/core/schema.ts";
import type { AgentSetup, OnboardingDraft } from "../web/src/desktop.ts";
import { briefPatch } from "../web/src/lib/brief.ts";
import { candidateNames, prepareWorkspace, readingAgent, sameSource } from "./library.ts";
import { WorkspaceServer } from "./workspaceServer.ts";

// The first workspace, made as soon as the user said what they make rather than on the last step,
// so the agent reads their material while they finish setting up: the brief is saved, the material
// learned into about.md, and a learn run has the agent read it, all on the workspace's server,
// which runs in the background until the board opens on it.

/** The workspace `name` in `library`, made or reused, or the next free name after it. */
const freeWorkspace = Effect.fn("firstWorkspace.free")(function* (library: string, name: string) {
  for (const candidate of candidateNames(name)) {
    const prepared = yield* prepareWorkspace(library, candidate, true);

    if (prepared.kind === "ready") return Option.some(prepared.path);
  }

  return Option.none<string>();
});

/** What the server takes from the first launch: the brief, a source to learn, a reading to start. */
type Body =
  | ReturnType<typeof briefPatch>
  | { readonly source: string }
  | { readonly kind: "learn"; readonly agent: AgentName; readonly locale: string }
  | Record<string, never>;

/** Sends `body` to the server at `url`, failing on any answer but a success. */
const call = (url: string, method: "POST" | "PATCH", path: string, body: Body) =>
  HttpClientRequest.make(method)(new URL(path, url).href).pipe(
    HttpClientRequest.bodyJsonUnsafe(body),
    HttpClient.execute,
    Effect.flatMap(HttpClientResponse.filterStatusOk),
  );

/** What the server says is learned: each source as it was given, and whether the agent read it. */
const LearnedList = Schema.Struct({
  learned: Schema.Array(
    Schema.Struct({
      doc: Schema.Struct({
        source: Schema.optional(
          Schema.Union([
            Schema.Struct({ path: Schema.String }),
            Schema.Struct({ url: Schema.String }),
          ]),
        ),
      }),
      unread: Schema.Boolean,
    }),
  ),
});

/** The imports, to tell whether a reading is under way. */
const ImportList = Schema.Array(
  Schema.Struct({
    doc: Schema.Struct({ kind: Schema.String, closed: Schema.Boolean }),
    running: Schema.Boolean,
  }),
);

const read = <A, I>(url: string, path: string, schema: Schema.Codec<A, I>) =>
  HttpClient.get(new URL(path, url).href).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
  );

/**
 * Saves the answers into the workspace on the server at `url`, learns each source not learned yet,
 * and starts the agent reading what is unread, unless a reading is under way. Run again, after the
 * user changed an answer or the app reopened, it adds only what is new. Material that can't be
 * learned is left out.
 */
const readInto = Effect.fn("firstWorkspace.readInto")(function* (
  url: string,
  draft: OnboardingDraft,
  agent: AgentName | undefined,
  locale: string,
) {
  yield* call(url, "PATCH", "/api/brief", briefPatch(draft.brief));

  const before = yield* read(url, "/api/learned", LearnedList);

  const saved = before.learned.flatMap(({ doc }) =>
    doc.source === undefined ? [] : ["url" in doc.source ? doc.source.url : doc.source.path],
  );

  for (const source of new Set(draft.sources.map((one) => one.trim()))) {
    if (source === "" || saved.some((one) => sameSource(source, one))) continue;

    yield* call(url, "POST", "/api/learn", { source }).pipe(
      Effect.tapError((error) => Effect.logWarning(`Could not learn ${source}`, error)),
      Effect.ignore,
    );
  }

  if (agent === undefined) return;

  const learned = yield* read(url, "/api/learned", LearnedList);
  const imports = yield* read(url, "/api/imports", ImportList);

  const underWay = imports.some(
    ({ doc, running }) => doc.kind === "learn" && !doc.closed && running,
  );

  if (underWay || !learned.learned.some(({ unread }) => unread)) return;

  yield* call(url, "POST", "/api/imports", { kind: "learn", agent, locale });
});

export class FirstWorkspaceFailed extends Schema.TaggedError<FirstWorkspaceFailed>()(
  "FirstWorkspaceFailed",
  { message: Schema.String },
) {}

export interface FirstWorkspaceInput {
  readonly library: string;
  readonly name: string;
  readonly draft: OnboardingDraft;
  /** The agents on this computer, to pick the one that reads. */
  readonly agents: Effect.Effect<
    ReadonlyArray<Pick<AgentSetup, "agent" | "state">>,
    { readonly message: string }
  >;
  /** The board's language, for the agent to write in. */
  readonly locale: string;
}

/**
 * Makes the first workspace and starts the reading, one run at a time: answers given again wait
 * for the run before, then add what is new.
 */
export class FirstWorkspace extends Context.Service<
  FirstWorkspace,
  {
    /** Makes the workspace from the answers, after any run before it, and is done with its folder. */
    start(input: FirstWorkspaceInput): Effect.Effect<string, FirstWorkspaceFailed>;
    /** The workspace the latest run made, once it is done; none if none was started or it failed. */
    readonly ready: Effect.Effect<Option.Option<string>>;
  }
>()("cutfac/desktop/FirstWorkspace") {
  static readonly layer = Layer.effect(
    FirstWorkspace,
    Effect.suspend(() => make),
  );
}

const failed = (error: { readonly message: string }) =>
  new FirstWorkspaceFailed({ message: error.message });

const make = Effect.gen(function* () {
  const services = yield* Effect.context<
    WorkspaceServer | HttpClient.HttpClient | FileSystem.FileSystem | Path.Path | Crypto.Crypto
  >();

  const lock = yield* Semaphore.make(1);
  const latest = yield* Ref.make(Option.none<Deferred.Deferred<string, FirstWorkspaceFailed>>());

  const run = ({ library, name, draft, agents, locale }: FirstWorkspaceInput) =>
    Effect.gen(function* () {
      const workspace = yield* freeWorkspace(library, name);

      if (Option.isNone(workspace)) {
        return yield* new FirstWorkspaceFailed({
          message: `No free name for ${name} in ${library}`,
        });
      }

      const server = yield* WorkspaceServer;
      const served = yield* server.serve(workspace.value);

      if (Option.isNone(served)) {
        return yield* new FirstWorkspaceFailed({ message: "The app is quitting" });
      }

      const agent = readingAgent(yield* agents);

      yield* readInto(served.value.url, draft, agent, locale);

      return workspace.value;
    }).pipe(Effect.mapError(failed), Effect.provideContext(services));

  const start = (input: FirstWorkspaceInput) =>
    Effect.gen(function* () {
      const done = yield* Deferred.make<string, FirstWorkspaceFailed>();

      yield* Ref.set(latest, Option.some(done));
      yield* lock
        .withPermits(1)(run(input))
        .pipe(
          Effect.exit,
          Effect.flatMap((exit) => Deferred.done(done, exit)),
          Effect.forkDetach,
        );

      return yield* Deferred.await(done);
    });

  const ready = Effect.flatMap(
    Ref.get(latest),
    Option.match({
      onNone: () => Effect.succeedNone,
      onSome: (done) => Effect.option(Deferred.await(done)),
    }),
  );

  return FirstWorkspace.of({ start, ready });
});
