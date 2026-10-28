import {
  Clock,
  Context,
  Deferred,
  Duration,
  Effect,
  Layer,
  Option,
  Path,
  Predicate,
  Ref,
  Schema,
  Scope,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CommandFailed, Conflict } from "./errors.ts";
import { getItem } from "./items.ts";
import { commandOptions, spawnFailure, STOP_GRACE } from "./process.ts";
import {
  appendLog,
  plainLine,
  readProgress,
  RenderProgress,
  START_PROGRESS,
} from "./renderProgress.ts";
import { Workspace } from "./workspace.ts";
import { STATE_DIR } from "./workspaceRoot.ts";

/**
 * Where renders report how far they are. The agent's MCP server runs them and the board reads
 * them, two processes apart, so it goes through files. A dot folder keeps the file watcher, which
 * reloads the board, from firing on every progress write.
 */
export const RENDERS_DIR = `${STATE_DIR}/renders`;

const fileKey = (item: string) => encodeURIComponent(item);

const statePath = (item: string) => `${RENDERS_DIR}/${fileKey(item)}.json`;

/** Left by the board to ask the process running the render to stop it. */
const stopPath = (item: string) => `${RENDERS_DIR}/${fileKey(item)}.stop`;

export const RENDER_STATUSES = ["running", "done", "failed", "stopped"] as const;

export const RenderState = Schema.Struct({
  item: Schema.String,
  command: Schema.String,
  /** Workspace-relative folder the command runs in; empty for the root. */
  cwd: Schema.String,
  /** The media file it writes, workspace-relative, when the agent said. */
  output: Schema.optional(Schema.String),
  /** Which version it makes, such as `v2`, when it is one of several. */
  label: Schema.optional(Schema.String),
  status: Schema.Literals(RENDER_STATUSES),
  progress: RenderProgress,
  /** Epoch milliseconds. */
  startedAt: Schema.Finite,
  endedAt: Schema.optional(Schema.Finite),
  code: Schema.optional(Schema.Finite),
  /** The last lines it printed, a progress line kept once. */
  log: Schema.Array(Schema.String),
  /** The process running it, to tell a render cut off with its agent from one going on. */
  owner: Schema.Finite,
});

export type RenderState = typeof RenderState.Type;

const RenderJson = Schema.fromJsonString(RenderState, { space: 2 });

const decodeState = Schema.decodeUnknownOption(RenderJson);

/** Whether process `pid` is still there. Signal 0 checks without sending anything. */
const alive = (pid: number) =>
  Effect.try(() => process.kill(pid, 0)).pipe(
    Effect.match({
      onSuccess: () => true,
      // Someone else's process is still a live one.
      onFailure: ({ cause }) =>
        cause instanceof Error && Predicate.hasProperty(cause, "code") && cause.code === "EPERM",
    }),
  );

/** How long a read that found the state file cut short waits for the write to finish. */
const WRITE_GAP = Duration.millis(50);

/**
 * The item's latest render, if it had one. A render still marked running whose process is gone
 * was cut off, when its agent quit say, so it reads as stopped, ended at its last save.
 */
export const readRender = Effect.fn("render.readRender")(function* (item: string) {
  const ws = yield* Workspace;
  const path = statePath(item);

  if (!(yield* ws.exists(path))) return Option.none<RenderState>();

  const read = Effect.map(ws.readText(path), decodeState);
  const first = yield* read;
  // Saving truncates the file before writing it, so a read can land in between.
  const state = Option.isSome(first) ? first : yield* Effect.andThen(Effect.sleep(WRITE_GAP), read);

  if (
    Option.isSome(state) &&
    state.value.status === "running" &&
    !(yield* alive(state.value.owner))
  ) {
    const { mtime } = yield* ws.stat(path);

    return Option.some<RenderState>({ ...state.value, status: "stopped", endedAt: mtime });
  }

  return state;
});

const isRunning = (state: Option.Option<RenderState>) =>
  Option.isSome(state) && state.value.status === "running";

/** The items whose render is going on now, sorted. */
export const runningRenders = Effect.fn("render.runningRenders")(function* () {
  const ws = yield* Workspace;
  const files = (yield* ws.list(RENDERS_DIR)).filter((entry) => entry.name.endsWith(".json"));

  const states = yield* Effect.forEach(files, (entry) =>
    readRender(decodeURIComponent(entry.name.slice(0, -".json".length))),
  );

  return states.flatMap((state) =>
    isRunning(state) ? Option.toArray(Option.map(state, ({ item }) => item)) : [],
  );
});

const writeRender = Effect.fn("render.writeRender")(function* (state: RenderState) {
  const ws = yield* Workspace;
  const text = yield* Schema.encodeEffect(RenderJson)(state).pipe(Effect.orDie);

  yield* ws.writeText(statePath(state.item), text);
});

/** Ask the process running the item's render to stop it; it checks twice a second. */
export const requestStop = Effect.fn("render.requestStop")(function* (item: string) {
  const ws = yield* Workspace;

  if (!isRunning(yield* readRender(item))) return;

  yield* ws.writeText(stopPath(item), "");
});

/** How often a running render saves how far it is and checks whether it was asked to stop. */
const TICK = Duration.millis(500);

/** Wait on a render another process runs by reading what it saves, until it ends. */
const waitSaved = (item: string, timeout: Duration.Input) =>
  Effect.gen(function* () {
    while (true) {
      const state = yield* readRender(item);

      if (!isRunning(state)) return state;

      yield* Effect.sleep(TICK);
    }
  }).pipe(
    Effect.timeoutOption(timeout),
    Effect.flatMap(Option.match({ onNone: () => readRender(item), onSome: Effect.succeed })),
  );

export interface RenderInput {
  readonly item: string;
  readonly command: string;
  /** The folder to run in, relative to the workspace root or absolute inside it. */
  readonly cwd?: string | undefined;
  readonly output?: string | undefined;
  readonly label?: string | undefined;
}

type ItemErrors = Effect.Error<ReturnType<typeof getItem>>;

/** The renders this process runs, which go on in the background between tool calls. */
export interface RenderJobs {
  /** Start the item's render; fails if one is already going, here or in another agent. */
  readonly start: (
    input: RenderInput,
  ) => Effect.Effect<RenderState, CommandFailed | Conflict | ItemErrors>;
  /** The item's render while this process runs it. */
  readonly current: (item: string) => Effect.Effect<Option.Option<RenderState>>;
  /**
   * The item's render once it ends, or where it stands after `timeout`. Without a render here,
   * the latest one saved, from any agent.
   */
  readonly wait: (
    item: string,
    timeout: Duration.Input,
  ) => Effect.Effect<Option.Option<RenderState>, ItemErrors>;
}

/** A render going on here: where it stands, and its end once it comes. */
interface Job {
  readonly state: Ref.Ref<RenderState>;
  readonly done: Deferred.Deferred<RenderState>;
}

type Ended = Pick<RenderState, "status" | "code">;

/** Runs renders for the life of `scope`: closing it kills the ones still going. */
export const makeRenders = Effect.gen(function* () {
  const ws = yield* Workspace;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const path = yield* Path.Path;
  const scope = yield* Scope.Scope;
  const jobs = yield* Ref.make<ReadonlyMap<string, Job>>(new Map());

  const jobOf = (item: string) =>
    Effect.map(Ref.get(jobs), (all) => Option.fromNullishOr(all.get(item)));

  const provide = <A, E>(effect: Effect.Effect<A, E, Workspace>) =>
    Effect.provideService(effect, Workspace, ws);

  /** Run the command to its end, keeping the job and its saved file up to date as it goes. */
  const execute = (job: Job, absCwd: string) =>
    Effect.gen(function* () {
      const { item, command } = yield* Ref.get(job.state);
      const dirty = yield* Ref.make(false);

      const onLine = (raw: string) => {
        const line = plainLine(raw);

        return Effect.andThen(
          Ref.update(job.state, (state) => ({
            ...state,
            progress: readProgress(state.progress, line),
            log: appendLog(state.log, line),
          })),
          Ref.set(dirty, true),
        );
      };

      const lines = <E>(stream: Stream.Stream<Uint8Array, E>) =>
        stream.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(onLine));

      const flush = Effect.flatMap(Ref.getAndSet(dirty, false), (changed) =>
        changed
          ? Effect.flatMap(Ref.get(job.state), (state) => provide(writeRender(state)))
          : Effect.void,
      );

      // A save or check that fails only skips a tick; it shouldn't end the render.
      const stopAsked = Effect.gen(function* () {
        while (true) {
          yield* Effect.sleep(TICK);
          yield* Effect.ignore(flush);

          if (yield* ws.exists(stopPath(item)).pipe(Effect.orElseSucceed(() => false))) {
            return { status: "stopped" } satisfies Ended;
          }
        }
      });

      const exit = Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* spawner.spawn(
            ChildProcess.make(command, [], {
              ...commandOptions({ cwd: absCwd, env: { FORCE_COLOR: "0" } }),
              shell: true,
              forceKillAfter: STOP_GRACE,
            }),
          );

          const [, , code] = yield* Effect.all(
            [lines(handle.stdout), lines(handle.stderr), handle.exitCode],
            { concurrency: "unbounded" },
          );

          return { status: code === 0 ? "done" : "failed", code } satisfies Ended;
        }),
      ).pipe(Effect.mapError(spawnFailure(command)));

      // Losing the race closes the command's scope, which kills it and what it started.
      return yield* Effect.raceFirst<Ended, CommandFailed, never, Ended, never, never>(
        exit,
        stopAsked,
      );
    });

  /** End the job. A save that fails leaves the file behind, which `start` knows to look past. */
  const finish = (job: Job, ended: Ended) =>
    Effect.gen(function* () {
      const endedAt = yield* Clock.currentTimeMillis;
      const state = yield* Ref.updateAndGet(job.state, (now) => ({ ...now, ...ended, endedAt }));

      yield* Effect.ignore(provide(writeRender(state)));
    });

  const start: RenderJobs["start"] = (input) =>
    ws.exclusive(
      `render:${input.item}`,
      provide(
        Effect.gen(function* () {
          const { item } = input;
          yield* getItem(item);

          const saved = yield* readRender(item);

          // One marked running by this process but no longer here ended without saving that.
          const elsewhere = Option.exists(
            saved,
            ({ status, owner }) => status === "running" && owner !== process.pid,
          );

          if (Option.isSome(yield* jobOf(item)) || elsewhere) {
            return yield* new Conflict({ message: `${item} is already rendering` });
          }

          const given = input.cwd ?? "";
          const cwd = path.isAbsolute(given) ? ws.rel(given) : given;
          const absCwd = yield* ws.abs(cwd);

          yield* ws.remove(stopPath(item)).pipe(Effect.ignore);

          const initial: RenderState = {
            item,
            command: input.command,
            cwd,
            output: input.output,
            label: input.label,
            status: "running",
            progress: START_PROGRESS,
            startedAt: yield* Clock.currentTimeMillis,
            log: [],
            owner: process.pid,
          };

          yield* writeRender(initial);

          const job: Job = {
            state: yield* Ref.make(initial),
            done: yield* Deferred.make<RenderState>(),
          };

          yield* Ref.update(jobs, (all) => new Map([...all, [item, job]]));

          yield* execute(job, absCwd).pipe(
            Effect.catch((error) =>
              Effect.as(
                Ref.update(job.state, (state) => ({
                  ...state,
                  log: appendLog(state.log, plainLine(error.message)),
                })),
                { status: "failed", code: undefined } satisfies Ended,
              ),
            ),
            Effect.flatMap((ended) => finish(job, ended)),
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Ref.update(jobs, (all) => new Map([...all].filter(([one]) => one !== item)));
                yield* Deferred.succeed(job.done, yield* Ref.get(job.state));
                yield* ws.remove(stopPath(item)).pipe(Effect.ignore);
              }),
            ),
            Effect.forkIn(scope),
          );

          return initial;
        }),
      ),
    );

  const wait: RenderJobs["wait"] = (item, timeout) =>
    Effect.flatMap(
      jobOf(item),
      Option.match({
        onNone: () => provide(waitSaved(item, timeout)),
        onSome: (job) =>
          Deferred.await(job.done).pipe(
            Effect.timeoutOption(timeout),
            Effect.andThen(Ref.get(job.state)),
            Effect.asSome,
          ),
      }),
    );

  const current: RenderJobs["current"] = (item) =>
    Effect.flatMap(
      jobOf(item),
      Option.match({
        onNone: () => Effect.succeedNone,
        onSome: (job) => Effect.asSome(Ref.get(job.state)),
      }),
    );

  const renders: RenderJobs = { start, current, wait };

  return renders;
});

/** The renders this MCP server runs, killed when it shuts down. */
export class Renders extends Context.Service<Renders, RenderJobs>()("cutfac/Renders") {
  static readonly layer = Layer.effect(Renders, makeRenders);
}
