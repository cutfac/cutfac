import { type Cause, Effect, FiberMap, Queue, Ref, type Scope, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { type AgentInvocation, type SessionArgs, isSessionId } from "./agentCommand.ts";
import type { AgentControl, RunEvent } from "./agentParse.ts";
import { detectAgentRelease, unreadableOutputMessage } from "./agentVersion.ts";
import { type Ask, refuse } from "./approval.ts";
import { newUuid } from "./crypto.ts";
import type { CutfacError } from "./errors.ts";
import { commandOptions, spawnFailure, STOP_GRACE, tail } from "./process.ts";
import type { Emit } from "./runRegistry.ts";
import type { AgentName } from "./schema.ts";
import { Workspace } from "./workspace.ts";

/**
 * `emit`, keeping track of whether the agent compacted the conversation on the way, so the run's
 * record can say so once the streamed steps are gone.
 */
export const noteCompaction = (emit: Emit) =>
  Effect.map(Ref.make(false), (compacted) => ({
    emit: (event: RunEvent) =>
      Effect.andThen(
        event.type === "compaction" && event.state === "done"
          ? Ref.set(compacted, true)
          : Effect.void,
        emit(event),
      ),
    /** For the record: true once it has, left out until then. */
    compacted: Effect.map(Ref.get(compacted), (done) => done || undefined),
  }));

interface Progress {
  readonly reply: string;
  readonly error: string | undefined;
  readonly signedOut: boolean;
  /** The session the agent reported, once it has been saved to the item. */
  readonly session: string | undefined;
  /** Whether any line gave a session or a reply, which says the output could be read at all. */
  readonly understood: boolean;
  /** Whether a change of effort alone keeps the conversation's prompt cache, once the agent says. */
  readonly effortKeepsCache: boolean | undefined;
}

interface Attempt extends Progress {
  readonly code: number;
  readonly stderr: string;
  /** The agent ended well but said nothing that could be read: its output has likely changed. */
  readonly unreadable: boolean;
}

/** Where a conversation keeps its session; `undefined` forgets it. */
export type SaveSession<R> = (sessionId: string | undefined) => Effect.Effect<void, CutfacError, R>;

const encoder = new TextEncoder();

/** What the agent reads on stdin, and how its requests get answered there. */
interface Input {
  readonly stdin: string | Stream.Stream<Uint8Array>;
  readonly onControl: (control: AgentControl) => Effect.Effect<void>;
  /** Closes stdin once the agent has given its result, so it exits as it would in a terminal. */
  readonly end: Effect.Effect<void>;
}

const unattendedInput = (stdin: string): Input => ({
  stdin,
  onControl: () => Effect.void,
  end: Effect.void,
});

/**
 * Stdin for an agent that asks before a tool: the first line, then each answer `ask` gets, sent as
 * soon as it comes, and whatever the agent's own lines call for. A request the agent takes back is
 * no longer put to anyone.
 */
const attendedInput = Effect.fnUntraced(function* (
  first: string,
  ask: Ask,
): Effect.fn.Return<Input, never, Scope.Scope> {
  const lines = yield* Queue.unbounded<Uint8Array, Cause.Done>();
  const asking = yield* FiberMap.make<string>();
  const send = (line: string) => Effect.asVoid(Queue.offer(lines, encoder.encode(line)));

  yield* send(first);

  const onControl = (control: AgentControl): Effect.Effect<void> => {
    switch (control.kind) {
      case "ask": {
        const { approval, answer } = control.request;
        const answered = Effect.flatMap(ask(approval), (a) => send(answer(a)));

        return Effect.asVoid(FiberMap.run(asking, approval.id, answered));
      }

      case "cancel":
        return FiberMap.remove(asking, control.id);
      case "reply":
        return Effect.forEach(control.lines, send, { discard: true });
    }
  };

  return { stdin: Stream.fromQueue(lines), onControl, end: Effect.asVoid(Queue.end(lines)) };
});

/**
 * Spawn the agent, stream its stdout through `parse`, and save its session the moment it is known
 * so a stop or crash still leaves the next request in the same conversation. Closing the scope
 * (a stop) terminates the agent's whole process group, and takes back anything it still asks.
 */
const attemptAgent = Effect.fnUntraced(function* <R>(
  agent: AgentName,
  invocation: AgentInvocation,
  storedSession: string | undefined,
  conversation: Pick<Conversation<R>, "emit" | "save" | "ask">,
) {
  const ws = yield* Workspace;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const { emit, save, ask = refuse } = conversation;

  const progress = yield* Ref.make<Progress>({
    reply: "",
    error: undefined,
    signedOut: false,
    session: storedSession,
    understood: false,
    effortKeepsCache: undefined,
  });

  const onLine = Effect.fnUntraced(function* (input: Input, line: string) {
    const parsed = invocation.parse(line, ws.root);
    yield* Effect.forEach(parsed.events, emit, { discard: true });

    if (parsed.control !== undefined) yield* input.onControl(parsed.control);
    const { session } = yield* Ref.get(progress);

    if (parsed.sessionId !== undefined && parsed.sessionId !== session) {
      yield* save(parsed.sessionId);
    }

    yield* Ref.update(progress, (state) => ({
      reply: parsed.reply ?? state.reply,
      error: parsed.error ?? state.error,
      signedOut: state.signedOut || parsed.signedOut === true,
      session: parsed.sessionId ?? state.session,
      understood: state.understood || parsed.sessionId !== undefined || parsed.reply !== undefined,
      effortKeepsCache: parsed.effortKeepsCache ?? state.effortKeepsCache,
    }));

    if (parsed.ended === true) yield* input.end;
  });

  const exit = yield* Effect.scoped(
    Effect.gen(function* () {
      const input =
        invocation.attended === true
          ? yield* attendedInput(invocation.stdin, ask)
          : unattendedInput(invocation.stdin);

      const command = ChildProcess.make(invocation.command, invocation.args, {
        ...commandOptions({ cwd: ws.root, stdin: input.stdin, env: invocation.env }),
        forceKillAfter: STOP_GRACE,
      });

      const handle = yield* spawner.spawn(command);

      const [, stderr, code] = yield* Effect.all(
        [
          handle.stdout.pipe(
            Stream.decodeText(),
            Stream.splitLines,
            Stream.runForEach((line) => onLine(input, line)),
          ),
          handle.stderr.pipe(Stream.decodeText(), Stream.mkString),
          handle.exitCode,
        ],
        { concurrency: "unbounded" },
      );

      return { stderr, code };
    }),
  ).pipe(Effect.catchTag("PlatformError", (error) => Effect.fail(spawnFailure(agent)(error))));

  const read = yield* Ref.get(progress);

  // An exit code of 0 with nothing read is a change in the agent's output, not a quiet success.
  const unreadable = exit.code === 0 && read.error === undefined && !read.understood;

  const attempt: Attempt = {
    ...read,
    ...exit,
    error: unreadable
      ? unreadableOutputMessage(agent, yield* detectAgentRelease(invocation.command))
      : read.error,
    unreadable,
  };

  return attempt;
});

const failureOf = (agent: AgentName, attempt: Attempt) => {
  if (attempt.error !== undefined) return attempt.error;

  if (attempt.code === 0) return undefined;
  const detail = tail(attempt.stderr, 3);

  return detail === "" ? `${agent} exited with code ${attempt.code}` : detail;
};

/** One turn of a conversation with an agent that keeps its session somewhere persistent. */
export interface Conversation<R> {
  readonly agent: AgentName;
  /** The session to resume, if there is one. */
  readonly stored: string | undefined;
  /** The command line for the turn; with no session to resume, the prompt must stand alone. */
  readonly invocation: (session: SessionArgs) => Effect.Effect<AgentInvocation, CutfacError, R>;
  readonly save: SaveSession<R>;
  readonly emit: Emit;
  /** Who answers what an attended agent asks; with no one, it is turned down. */
  readonly ask?: Ask | undefined;
}

export interface TurnResult {
  readonly reply: string;
  /** Why the turn failed, if it did. */
  readonly failure: string | undefined;
  readonly signedOut?: true | undefined;
  /** Whether a change of effort alone keeps the conversation's prompt cache, if the agent said. */
  readonly effortKeepsCache?: boolean | undefined;
}

/** Run one turn, starting a fresh session when the stored one is gone. */
export const converse = Effect.fnUntraced(function* <R>(conversation: Conversation<R>) {
  const { agent, stored, save } = conversation;

  const attempt = Effect.fnUntraced(function* (sessionId: string | undefined) {
    const newSessionId = yield* newUuid;
    const invocation = yield* conversation.invocation({ sessionId, newSessionId });

    return yield* attemptAgent(agent, invocation, sessionId, conversation);
  });

  // Only a session the agent made goes back to it; anything else is replaced by a new one.
  const resumed = stored !== undefined && isSessionId(stored) ? stored : undefined;
  const first = yield* attempt(resumed);

  // A resumed session the agent no longer has fails before the agent says anything: start fresh.
  const staleSession =
    resumed !== undefined &&
    !first.understood &&
    !first.unreadable &&
    failureOf(agent, first) !== undefined;

  const final = staleSession ? yield* Effect.andThen(save(undefined), attempt(undefined)) : first;

  const failure = failureOf(agent, final);

  const result: TurnResult = {
    reply: final.reply,
    failure,
    signedOut: (failure !== undefined && final.signedOut) || undefined,
    effortKeepsCache: final.effortKeepsCache,
  };

  return result;
});
