import { Effect, Layer, ManagedRuntime, Option, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import type { AgentName } from "../src/core/schema.ts";
import type { AgentSetup, OnboardingDraft } from "../web/src/desktop.ts";
import { briefPatch } from "../web/src/lib/brief.ts";
import { candidateNames, prepareWorkspace, readingAgent, sameSource } from "./library.ts";
import { platform } from "./platform.ts";
import { appLog, memoMap } from "./runtime.ts";

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

export interface FirstWorkspaceHost {
  /** Starts the server on `workspace`, unless it serves it already. Resolves its address. */
  serve: (workspace: string) => Promise<string>;
  agents: () => Promise<ReadonlyArray<Pick<AgentSetup, "agent" | "state">>>;
  locale: () => string;
}

/**
 * Makes the first workspace and starts the reading, one run at a time: answers given again wait
 * for the run before, then add what is new. `ready` resolves the workspace once the latest is
 * done, for the last step to open.
 */
export function firstWorkspace(host: FirstWorkspaceHost) {
  // The workspace's folder and `fetch` to its server, beside the app's log.
  const runtime = ManagedRuntime.make(Layer.mergeAll(platform, FetchHttpClient.layer, appLog), {
    memoMap,
  });

  let latest: Promise<string | undefined> = Promise.resolve(undefined);

  const run = async (library: string, name: string, draft: OnboardingDraft) => {
    const workspace = Option.getOrUndefined(await runtime.runPromise(freeWorkspace(library, name)));

    if (workspace === undefined) throw new Error(`No free name for ${name} in ${library}`);

    const url = await host.serve(workspace);
    const agent = readingAgent(await host.agents());

    await runtime.runPromise(readInto(url, draft, agent, host.locale()));

    return workspace;
  };

  return {
    /** Makes the workspace `name` in `library` from `draft`, after any run before it. */
    start: (library: string, name: string, draft: OnboardingDraft) => {
      latest = latest.catch(() => undefined).then(() => run(library, name, draft));

      return latest;
    },
    /** The workspace the latest run made, once it is done; undefined if none was started. */
    ready: () => latest,
  };
}
