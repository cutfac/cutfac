import {
  Cause,
  type Context,
  Deferred,
  Effect,
  Fiber,
  FiberSet,
  Layer,
  Option,
  PubSub,
  type Scope,
  Semaphore,
  Stream,
} from "effect";

import type { RunEvent } from "./agentParse.ts";
import type { ApprovalAnswer, Ask } from "./approval.ts";
import { Conflict } from "./errors.ts";

export type Emit = (event: RunEvent) => Effect.Effect<void>;

/**
 * Runs one request to the end, reporting progress through `emit` and putting what the agent asks
 * to the board through `ask`. Never fails: errors become events.
 */
export type Runner<I, R> = (input: I, emit: Emit, ask: Ask) => Effect.Effect<void, never, R>;

/** The first line of `text`, kept short enough for a status or an error line. */
export const firstLine = (text: string) => text.trim().split("\n")[0]?.slice(0, 200) ?? "";

export interface RunSubscription {
  /** What the latest run is about, if the key has had one since the server started. */
  readonly subject: Option.Option<string>;
  /** The latest run's events so far, then everything after, across later runs too. */
  readonly events: Stream.Stream<RunEvent>;
}

/** What a registry runs and how its runs are keyed. */
export interface RunSpec<I, R> {
  /** One run at a time per key, such as the item a request is on. */
  readonly key: (input: I) => string;
  /** What a run is about, sent to subscribers before its events. */
  readonly subject: (input: I) => string;
  /** Why a run cannot start while its key has one. */
  readonly busy: string;
  readonly runner: Runner<I, R>;
  /**
   * What the key has lined up after a run that finished its work, if anything. A run must take
   * itself out of the line when it starts, or it would be offered again.
   */
  readonly next?: (input: I) => Effect.Effect<Option.Option<I>, never, R>;
}

/** The runs of one kind, keyed by what they work on. */
export interface Runs<I> {
  readonly start: (input: I) => Effect.Effect<void, Conflict>;
  /**
   * Interrupt the key's run; resolves once the agent is gone and the stop is recorded. False when
   * no run was working, including one that already reported its end.
   */
  readonly stop: (key: string) => Effect.Effect<boolean>;
  /**
   * Answer what the key's run asked; false when it is no longer waiting on that request, as after
   * another answer, the agent taking it back, or the run's end.
   */
  readonly answer: (key: string, id: string, answer: ApprovalAnswer) => Effect.Effect<boolean>;
  /** Whether the key has a run that has not reported its end yet. */
  readonly isRunning: (key: string) => Effect.Effect<boolean>;
  /** How many requests the key's run waits on the board to answer. */
  readonly pending: (key: string) => Effect.Effect<number>;
  /**
   * The key each time its run puts a request to the board or has one settled, so a view of every
   * key, such as the gallery, can look again without following each run.
   */
  readonly asks: Stream.Stream<string>;
  readonly subscribe: (key: string) => Effect.Effect<RunSubscription, never, Scope.Scope>;
  /**
   * Run `effect` while no other exclusive effect on the key runs, so a check and the start it
   * guards, or a stop and what follows it, are not cut in on.
   */
  readonly exclusive: <A, E, R>(
    key: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

/** A run; it holds its key until it reports how it ended. */
interface LiveRun {
  fiber: Fiber.Fiber<void> | undefined;
  ended: RunEvent["type"] | undefined;
  /** The requests it waits on an answer to, by the agent's id for them. */
  readonly pending: Map<string, Deferred.Deferred<ApprovalAnswer>>;
}

interface Channel {
  readonly pubsub: PubSub.PubSub<RunEvent>;
  /** Takes turns between exclusive effects on the key. */
  readonly turns: Semaphore.Semaphore;
  subject: Option.Option<string>;
  events: Array<RunEvent>;
  /** The run the key is busy with; the events of any other are late and dropped. */
  live: LiveRun | undefined;
}

const ENDINGS = new Set<RunEvent["type"]>(["done", "stopped", "error"]);

const crashMessage = (cause: Cause.Cause<never>) =>
  firstLine(Cause.pretty(cause)) || "The agent run crashed";

/**
 * Put requests to whoever watches `run`. A request is on the board from the moment it is pending
 * until it is settled, however that happens: an answer, the agent taking it back, or a stop.
 */
const askVia =
  (emit: Emit, run: LiveRun, changed: Effect.Effect<void>): Ask =>
  (approval) =>
    Effect.uninterruptibleMask((restore) =>
      Effect.gen(function* () {
        const { id } = approval;
        const answer = yield* Deferred.make<ApprovalAnswer>();
        run.pending.set(id, answer);
        yield* emit({ type: "approval", ...approval });
        yield* changed;

        return yield* restore(Deferred.await(answer)).pipe(
          Effect.ensuring(
            Effect.suspend(() => {
              if (run.pending.get(id) === answer) run.pending.delete(id);

              return Effect.andThen(emit({ type: "approval-settled", id }), changed);
            }),
          ),
        );
      }),
    );

/**
 * One run at a time per key. A run holds its key until it reports its end, not until its fiber
 * is gone, so the next one can start as soon as the board hears it ended. A board that connects
 * mid-run, or reloads, gets the latest run's events replayed before live ones. Persistent state
 * lives in the workspace, not here.
 */
export const makeRunRegistry = Effect.fnUntraced(function* <I, R>(spec: RunSpec<I, R>) {
  const context = yield* Effect.context<R>();
  const fibers = yield* FiberSet.make();
  const channels = new Map<string, Channel>();
  const asked = yield* PubSub.unbounded<string>();
  // Recording an event and taking a snapshot for a new subscriber must not interleave, or a
  // subscriber would see an event twice or miss it.
  const lock = yield* Semaphore.make(1);
  const locked = lock.withPermits(1);

  const channelFor = (key: string) =>
    locked(
      Effect.gen(function* () {
        const existing = channels.get(key);

        if (existing !== undefined) return existing;

        const created: Channel = {
          pubsub: yield* PubSub.unbounded<RunEvent>(),
          turns: yield* Semaphore.make(1),
          subject: Option.none(),
          events: [],
          live: undefined,
        };

        channels.set(key, created);

        return created;
      }),
    );

  const emitTo =
    (channel: Channel, run: LiveRun): Emit =>
    (event) =>
      locked(
        Effect.suspend(() => {
          if (channel.live !== run) return Effect.void;

          if (ENDINGS.has(event.type)) {
            channel.live = undefined;
            run.ended = event.type;
          }

          channel.events.push(event);

          return PubSub.publish(channel.pubsub, event);
        }),
      );

  // A run that finished its work hands the key to the next one lined up. One that failed or was
  // stopped leaves the line for the user, and nothing starts while another run holds the key.
  const startNext = (input: I, channel: Channel) =>
    channel.turns.withPermits(1)(
      Effect.gen(function* () {
        if (spec.next === undefined || channel.live !== undefined) return;
        const next = yield* spec.next(input);

        if (Option.isSome(next)) yield* start(next.value).pipe(Effect.ignore);
      }),
    );

  // Every run reports one end: its own, or the one added here. Once it has, these are dropped,
  // such as the "stopped" of a stop that landed as the run finished.
  const supervise = (input: I, channel: Channel, run: LiveRun) => {
    const emit = emitTo(channel, run);

    const changed = PubSub.publish(asked, spec.key(input)).pipe(Effect.asVoid);

    return spec.runner(input, emit, askVia(emit, run, changed)).pipe(
      Effect.andThen(emit({ type: "error", error: "The agent run ended without a result" })),
      Effect.onInterrupt(() => emit({ type: "stopped" })),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : emit({ type: "error", error: crashMessage(cause) }),
      ),
      Effect.andThen(() => (run.ended === "done" ? startNext(input, channel) : Effect.void)),
      Effect.provideContext(context),
    );
  };

  const start = (input: I): Effect.Effect<void, Conflict> =>
    Effect.gen(function* () {
      const channel = yield* channelFor(spec.key(input));

      yield* locked(
        Effect.gen(function* () {
          if (channel.live !== undefined) return yield* new Conflict({ message: spec.busy });

          // The run's first event waits for this lock, so its fiber is known by then.
          const run: LiveRun = { fiber: undefined, ended: undefined, pending: new Map() };
          channel.live = run;
          channel.subject = Option.some(spec.subject(input));
          channel.events = [];
          run.fiber = yield* FiberSet.run(fibers, supervise(input, channel, run));
        }),
      );
    });

  const stop = (key: string) =>
    Effect.gen(function* () {
      // Read under the lock, which a starting run holds until its fiber is known.
      const fiber = yield* locked(Effect.sync(() => channels.get(key)?.live?.fiber));

      if (fiber === undefined) return false;

      // Not under the lock: the run reports its stop through it.
      yield* Fiber.interrupt(fiber);

      return true;
    });

  const answer = (key: string, id: string, choice: ApprovalAnswer) =>
    Effect.suspend(() => {
      const pending = channels.get(key)?.live?.pending.get(id);

      return pending === undefined ? Effect.succeed(false) : Deferred.succeed(pending, choice);
    });

  const isRunning = (key: string) => Effect.sync(() => channels.get(key)?.live !== undefined);

  const pending = (key: string) => Effect.sync(() => channels.get(key)?.live?.pending.size ?? 0);

  const subscribe = (key: string) =>
    Effect.gen(function* () {
      const channel = yield* channelFor(key);

      return yield* locked(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(channel.pubsub);
          const replay = [...channel.events];

          const result: RunSubscription = {
            subject: channel.subject,
            events: Stream.concat(
              Stream.fromIterable(replay),
              Stream.fromSubscription(subscription),
            ),
          };

          return result;
        }),
      );
    });

  const exclusive = <A, E, R2>(key: string, effect: Effect.Effect<A, E, R2>) =>
    Effect.flatMap(channelFor(key), (channel) => channel.turns.withPermits(1)(effect));

  const registry: Runs<I> = {
    start,
    stop,
    answer,
    isRunning,
    pending,
    asks: Stream.fromPubSub(asked),
    subscribe,
    exclusive,
  };

  return registry;
});

/** A layer for `service` that runs `spec`, one run per key. */
export const runsLayer = <Self, I, R>(service: Context.Key<Self, Runs<I>>, spec: RunSpec<I, R>) =>
  Layer.effect(service, makeRunRegistry(spec));
