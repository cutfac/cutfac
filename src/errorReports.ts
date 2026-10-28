import {
  Cause,
  Context,
  Effect,
  Layer,
  LogLevel,
  Logger,
  Option,
  Predicate,
  Queue,
  Ref,
  References,
  Schema,
} from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { peekAppStore, updateAppStore } from "./core/appStore.ts";
import { APP_VERSION } from "./core/build.ts";
import { newUuid } from "./core/crypto.ts";
import { ErrorSink, OPERATION, homeScrubber } from "./core/logFile.ts";

// The desktop app's error reports, which go to the Cutfac team's PostHog project once the person
// says yes. Only a release build can send them: it alone carries the project's key.

/**
 * The PostHog project key, a write-only token. A release build writes it in, as `bun build --env`
 * inlines CUTFAC_POSTHOG_KEY from `.env.release`; from source, and in forks, there is none.
 */
export const ReportKey = Context.Reference<Option.Option<string>>("cutfac/ReportKey", {
  // `bun build --env` inlines only `process.env.NAME` written out, never a Config read at runtime.
  // @effect-diagnostics-next-line processEnv:off
  defaultValue: () => Option.fromNullishOr(process.env.CUTFAC_POSTHOG_KEY || undefined),
});

/** PostHog's US cloud, where the project lives. */
export const REPORTS_URL = "https://us.i.posthog.com/i/v0/e/";

/** At most this many reports leave one run of a process, so a loop of failures can't flood. */
const MAX_REPORTS = 20;

const REPORT_TIMEOUT = "10 seconds";

/** How much of a failure's cause goes with its report. */
const MAX_CAUSE_CHARS = 4000;

/** The app's record of the person's choice, in its data folder. */
const STORE = "telemetry.json";

const decodeChoice = Schema.decodeUnknownOption(Schema.Boolean);

const decodeId = Schema.decodeUnknownOption(Schema.NonEmptyString);

/** Whether reports can go at all, what the person chose, and the ID reports and feedback share. */
export interface ReportSettings {
  /** This build carries the key; without it there is nothing to ask. */
  readonly available: boolean;
  /** None until the person chooses. */
  readonly errorReports: Option.Option<boolean>;
  /** Whether usage statistics go too; none until the person chooses. */
  readonly usageStats: Option.Option<boolean>;
  /** A random ID for this install, made with the first choice and reset on request. */
  readonly installId: Option.Option<string>;
}

/** The person's choice and this install's ID, as the app's data folder has them. */
export const reportSettings = Effect.gen(function* () {
  const store = yield* peekAppStore(STORE);

  return {
    available: Option.isSome(yield* ReportKey),
    errorReports: decodeChoice(store["errorReports"]),
    usageStats: decodeChoice(store["usageStats"]),
    installId: decodeId(store["installId"]),
  } satisfies ReportSettings;
});

/** What the person chose to send; a choice left out stays as it was. */
export interface ReportChoices {
  readonly errorReports?: boolean;
  readonly usageStats?: boolean;
}

/** Saves the person's choices, making this install's ID with the first one. */
export const setReportChoices = Effect.fn("errorReports.set")(function* (choices: ReportChoices) {
  const id = yield* newUuid;

  yield* updateAppStore(STORE, "what to send the Cutfac team", (store) => ({
    ...store,
    ...choices,
    installId: Option.getOrElse(decodeId(store["installId"]), () => id),
  }));

  return yield* reportSettings;
});

/** Gives this install a new ID, so later reports and feedback no longer match the earlier ones. */
export const resetInstallId = Effect.fn("errorReports.resetInstallId")(function* () {
  const id = yield* newUuid;

  yield* updateAppStore(STORE, "the install ID", (store) => ({ ...store, installId: id }));

  return yield* reportSettings;
});

/**
 * The install ID feedback carries: only with its log, and only while the person sends error
 * reports, so the team can match the two. Other feedback stays apart from the reports.
 */
export const feedbackInstallId = (withLogs: boolean | undefined) =>
  withLogs === true
    ? Effect.map(reportSettings, ({ errorReports, installId }) =>
        Option.getOrElse(errorReports, () => false) ? installId : Option.none<string>(),
      )
    : Effect.succeed(Option.none<string>());

/** What a report says about one failure. */
interface Report {
  readonly type: string;
  readonly message: string;
  readonly operation: Option.Option<string>;
  readonly cause: string;
  readonly at: Date;
}

/**
 * The failure's own name and message: from the error that failed or the defect that died, else
 * from an error logged as the line's value, as a server answering 500 logs it, else the words.
 */
function failureOf(cause: Cause.Cause<unknown>, logged: Error | undefined, fallback: string) {
  const error = Cause.hasFails(cause) || Cause.hasDies(cause) ? Cause.squash(cause) : logged;

  if (!(error instanceof Error)) return { type: "Error", message: fallback };

  const tag = Predicate.hasProperty(error, "_tag") ? error._tag : undefined;

  return { type: Predicate.isString(tag) ? tag : error.name, message: error.message };
}

/** Takes each line at error level and up, the failure it is about, as a report to send. */
const collecting = (reports: Queue.Queue<Report>) =>
  Logger.make(({ message, logLevel, cause, fiber, date }) => {
    if (!LogLevel.isGreaterThanOrEqualTo(logLevel, "Error")) return;

    const parts = Array.isArray(message) ? message : [message];

    // The line's words, without the values logged beside them.
    const text = parts.filter(Predicate.isString).join(" ");
    const logged = parts.find((part): part is Error => part instanceof Error);

    const named = fiber.getRef(References.CurrentLogAnnotations)[OPERATION];

    Queue.offerUnsafe(reports, {
      ...failureOf(cause, logged, text),
      operation: Option.filter(Option.fromNullishOr(named), Predicate.isString),
      cause: Cause.pretty(cause),
      at: date,
    });
  });

/**
 * Sends `report` as a PostHog exception, if the person still sends reports now: a choice turned
 * off takes hold at once. The person's install ID is the only identity it carries, and PostHog
 * keeps no profile for it.
 */
const send = Effect.fnUntraced(function* (key: string, processName: string, report: Report) {
  const settings = yield* reportSettings;

  if (!Option.getOrElse(settings.errorReports, () => false)) return;

  if (Option.isNone(settings.installId)) return;

  const scrub = yield* homeScrubber;

  const operation = Option.getOrElse(report.operation, () => "");

  const where = Option.match(report.operation, {
    onNone: () => "",
    onSome: (name) => ` in ${name}`,
  });

  const event = {
    api_key: key,
    event: "$exception",
    distinct_id: settings.installId.value,
    timestamp: report.at.toISOString(),
    properties: {
      $exception_list: [
        {
          type: report.type,
          value: scrub(report.message),
          mechanism: { handled: true, synthetic: false },
        },
      ],
      $exception_level: "error",
      // Grouped by where and how it failed, not by a message that names files.
      $exception_fingerprint: `${processName}:${operation}:${report.type}`,
      // Named as it is grouped, so the issue list says what failed and where, not just its type.
      $issue_name: `${report.type}${where} (${processName})`,
      $process_person_profile: false,
      process: processName,
      operation,
      app_version: APP_VERSION,
      platform: process.platform,
      cause: scrub(report.cause).slice(0, MAX_CAUSE_CHARS),
    },
  };

  yield* HttpClientRequest.post(REPORTS_URL).pipe(
    HttpClientRequest.bodyJsonUnsafe(event),
    HttpClient.execute,
    Effect.timeout(REPORT_TIMEOUT),
    // A report that can't go is dropped; it is in the log either way.
    Effect.ignore,
  );
});

/**
 * Reports this process's failures, `app`, `server` or `mcp`, through the log's `ErrorSink`: each
 * failure once a run, at most `MAX_REPORTS` of them, and only while the person says yes. A build
 * without the key reports nothing.
 */
export const errorReports = (processName: string) =>
  Layer.effect(
    ErrorSink,
    Effect.gen(function* () {
      const key = yield* ReportKey;

      if (Option.isNone(key)) return Option.none();

      const reports = yield* Queue.unbounded<Report>();
      const sent = yield* Ref.make<ReadonlySet<string>>(new Set());

      yield* Queue.take(reports).pipe(
        Effect.flatMap((report) =>
          Effect.gen(function* () {
            const id = `${Option.getOrElse(report.operation, () => "")}:${report.type}:${report.message}`;
            const before = yield* Ref.get(sent);

            if (before.has(id) || before.size >= MAX_REPORTS) return;

            yield* Ref.set(sent, new Set([...before, id]));
            yield* send(key.value, processName, report);
          }),
        ),
        Effect.forever,
        Effect.forkScoped,
      );

      return Option.some(collecting(reports));
    }),
  );
