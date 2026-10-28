import {
  Cause,
  Context,
  DateTime,
  Duration,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Logger,
  Option,
  Path,
  Predicate,
  Queue,
  Tracer,
} from "effect";

import { BUNDLED } from "./build.ts";
import { envVar } from "./env.ts";

// The desktop app's own log, which stays on this Mac. People can send it with their feedback.

/** Logs older than this, or past this much in all, are removed when a process starts. */
const KEEP = Duration.days(7);

const KEEP_BYTES = 50 * 1024 * 1024;

/** A top-level operation that took this long is worth a line even when it went well. */
const SLOW = Duration.seconds(1);

/** A day's log of one process, such as `server-2026-10-28.log`. */
const LOG_FILE = /^[a-z]+-(\d{4}-\d{2}-\d{2})\.log$/;

/** The days of logs in `dir`, newest first, each with its file and the day it covers. */
export const dayLogs = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return (yield* fs.readDirectory(dir))
    .flatMap((name) => {
      const day = LOG_FILE.exec(name)?.[1];

      return day === undefined ? [] : [{ name, file: path.join(dir, name), day }];
    })
    .toSorted((a, b) => b.day.localeCompare(a.day) || a.name.localeCompare(b.name));
});

/**
 * Where this process's errors go beside its log file: nowhere unless the app reports them, which
 * the person chooses. It sees every line the file does and keeps what it wants.
 */
export const ErrorSink = Context.Reference<Option.Option<Logger.Logger<unknown, void>>>(
  "cutfac/ErrorSink",
  { defaultValue: () => Option.none() },
);

/** The log annotation that names the top-level operation a line is about. */
export const OPERATION = "operation";

/** The folder the desktop app keeps its logs in. None for the open-source CLI, which keeps none. */
export const LogDir = Context.Reference<Option.Option<string>>("cutfac/LogDir", {
  defaultValue: () => Option.none(),
});

/** Shows the home folder as `~` in text, as the log does, so what it holds says less of who. */
export const homeScrubber = Effect.map(
  envVar("HOME"),
  (home) => (text: string) =>
    Option.match(home, {
      onNone: () => text,
      onSome: (folder) => (folder.length > 1 ? text.replaceAll(folder, "~") : text),
    }),
);

/**
 * `~/Library/Logs/Cutfac` for the binary the desktop app bundles. Electron's main process, and the
 * app run from source, name the folder in CUTFAC_LOG_DIR.
 */
export const logDir = Layer.effect(
  LogDir,
  Effect.gen(function* () {
    if (!BUNDLED) return yield* envVar("CUTFAC_LOG_DIR");

    const path = yield* Path.Path;

    return Option.map(yield* envVar("HOME"), (home) =>
      path.join(home, "Library", "Logs", "Cutfac"),
    );
  }),
);

/** Removes the days of logs past `KEEP`, then the oldest until what is left fits `KEEP_BYTES`. */
const prune = Effect.fnUntraced(function* (dir: string, today: DateTime.Utc) {
  const fs = yield* FileSystem.FileSystem;

  const oldest = DateTime.formatIsoDateUtc(
    DateTime.subtract(today, { days: Duration.toDays(KEEP) }),
  );

  yield* Effect.reduce(
    yield* dayLogs(dir),
    () => 0,
    (kept: number, { file, day }) =>
      Effect.gen(function* () {
        const { size } = yield* fs.stat(file);
        const total = kept + Number(size);

        if (day >= oldest && total <= KEEP_BYTES) return total;

        // Another process may have removed it first.
        yield* fs.remove(file).pipe(Effect.ignore);

        return kept;
      }),
  );
});

/** Effect's Toolkit names the tool it runs under this key of the request's span. */
const TOOL = "tool";

/** Why an operation that ended well answered with an error, under this key of its span. */
const ANSWERED_WITH_ERROR = "cutfac.error";

/**
 * Marks the current top-level operation as one that answered with `message`, such as a tool call
 * an agent got wrong: it ends well, so the log would otherwise not say.
 */
export const answeredWithError = (message: string) =>
  Effect.annotateCurrentSpan(ANSWERED_WITH_ERROR, message);

/** A top-level operation that ended, as the log keeps it. */
interface Ended {
  readonly name: string;
  readonly took: Duration.Duration;
  readonly exit: Exit.Exit<unknown, unknown>;
  readonly error: Option.Option<string>;
}

/** Whether `ended` belongs in the log: it failed, it was slow, or an agent asked for it. */
const worthKeeping = ({ name, took, exit, error }: Ended) =>
  (Exit.isFailure(exit) && !Cause.hasInterruptsOnly(exit.cause)) ||
  Option.isSome(error) ||
  Duration.isGreaterThanOrEqualTo(took, SLOW) ||
  name.startsWith("McpServer.");

/** A span's attribute under `key`, when it is text. */
const textAttribute = (span: Tracer.Span, key: string) =>
  Option.filter(Option.fromNullishOr(span.attributes.get(key)), Predicate.isString);

/** `base`, but every span without a parent in this process is offered to `ended` as it ends. */
const tracking = (base: Tracer.Tracer, ended: Queue.Queue<Ended>) =>
  Tracer.make({
    span(options) {
      const span = base.span(options);

      if (Option.isSome(options.parent)) return span;

      const end = span.end.bind(span);

      return Object.assign(span, {
        end(endTime: bigint, exit: Exit.Exit<unknown, unknown>) {
          end(endTime, exit);

          // Only the tool's name; the parameters beside it can hold what the user wrote.
          const tool = textAttribute(span, TOOL);

          Queue.offerUnsafe(ended, {
            name: Option.match(tool, {
              onNone: () => options.name,
              onSome: (named) => `${options.name} ${named}`,
            }),
            took: Duration.nanos(endTime - options.startTime),
            exit,
            error: textAttribute(span, ANSWERED_WITH_ERROR),
          });
        },
      });
    },
    context: base.context,
  });

/** The line an operation that ended leaves in the log. */
const record = ({ name, took, exit, error }: Ended) => {
  const line = `${name} took ${Math.round(Duration.toMillis(took))}ms`;

  return Exit.match(exit, {
    onSuccess: () =>
      Option.match(error, {
        onNone: () => Effect.logInfo(line),
        onSome: (message) => Effect.logWarning(`${line} and answered with an error: ${message}`),
      }),
    onFailure: (cause) => Effect.logError(`${line} and failed`, cause),
  }).pipe(Effect.annotateLogs(OPERATION, name));
};

/**
 * Writes this process's logs to `<name>-<day>.log` in `LogDir`, beside wherever they already go,
 * with the home folder shown as `~`. Each top-level operation that failed, took a second or more,
 * or answered an agent also leaves a line there, and only there. Without a `LogDir`, or when the
 * folder can't be written, nothing changes: the log must never stop the app.
 */
export const logToFile = (name: string) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const dir = yield* LogDir;

      if (Option.isNone(dir)) return Layer.empty;

      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const today = yield* DateTime.now;
      const scrub = yield* homeScrubber;

      yield* fs.makeDirectory(dir.value, { recursive: true });
      yield* prune(dir.value, today);

      const scrubbed = Logger.map(Logger.formatJson, scrub);

      const file = path.join(dir.value, `${name}-${DateTime.formatIsoDateUtc(today)}.log`);
      const fileLogger = yield* Logger.toFile(scrubbed, file);
      const loggers = [fileLogger, ...Option.toArray(yield* ErrorSink)];
      const ended = yield* Queue.unbounded<Ended>();
      const base = yield* Tracer.Tracer;

      yield* Queue.take(ended).pipe(
        Effect.flatMap((one) => (worthKeeping(one) ? record(one) : Effect.void)),
        Effect.forever,
        Effect.provideService(Logger.CurrentLoggers, new Set(loggers)),
        Effect.forkScoped,
      );

      return Layer.mergeAll(
        Logger.layer(loggers, { mergeWithExisting: true }),
        Layer.succeed(Tracer.Tracer, tracking(base, ended)),
      );
    }).pipe(Effect.orElseSucceed(() => Layer.empty)),
  );
