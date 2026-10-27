import { describe, expect } from "bun:test";

// Each check builds the reports with the key, settings and fake PostHog that check needs.
// @effect-diagnostics strictEffectProvide:off
import {
  ConfigProvider,
  Effect,
  FileSystem,
  Layer,
  Logger,
  Option,
  Predicate,
  Ref,
  Schema,
} from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { AppData } from "../src/core/appData.ts";
import { APP_VERSION } from "../src/core/build.ts";
import { CommandFailed } from "../src/core/errors.ts";
import { ErrorSink, LogDir, logToFile } from "../src/core/logFile.ts";
import {
  REPORTS_URL,
  ReportKey,
  errorReports,
  feedbackInstallId,
  reportSettings,
  resetInstallId,
  setReportChoices,
} from "../src/errorReports.ts";
import { trackUsage } from "../src/usageStats.ts";
import { testEffect } from "./effect.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace());

const KEY = "phc_test";

const HOME = "/Users/someone";

/** What PostHog was sent: each event's JSON. */
type Sent = Ref.Ref<ReadonlyArray<Schema.Json>>;

const decodeEvent = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

/** PostHog, taking whatever comes and keeping it in `sent`. */
const posthog = (sent: Sent) =>
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      if (url.href === REPORTS_URL && Predicate.isTagged(request.body, "Uint8Array")) {
        const event = yield* Effect.orDie(decodeEvent(new TextDecoder().decode(request.body.body)));

        yield* Ref.update(sent, (all) => [...all, event]);
      }

      return HttpClientResponse.fromWeb(request, Response.json({ status: 1 }));
    }),
  );

const nothingSent = () => Ref.make<ReadonlyArray<Schema.Json>>([]);

/** The app's data folder for the test, removed after it. */
const dataFolder = Effect.flatMap(FileSystem.FileSystem, (fs) =>
  fs.makeTempDirectoryScoped({ prefix: "cutfac-reports-" }),
);

const asApp = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  data: string,
  { sent, key = KEY }: { readonly sent?: Sent; readonly key?: string } = {},
) =>
  effect.pipe(
    Effect.provideService(AppData, Option.some(data)),
    Effect.provideService(ReportKey, Option.fromNullishOr(key || undefined)),
    Effect.provideServiceEffect(
      HttpClient.HttpClient,
      Effect.map(sent === undefined ? nothingSent() : Effect.succeed(sent), posthog),
    ),
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env: { HOME } }))),
  );

/** Lets the reports' own fiber send what it got. */
const settle = Effect.sleep("20 millis");

/** Logs `effect`'s failure through the reports, as a process's log does. */
const reported = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const sink = yield* ErrorSink;

    yield* effect.pipe(Effect.provide(Logger.layer(Option.toArray(sink))));
    yield* settle;
  }).pipe(Effect.provide(errorReports("server")));

describe("the error report choice", () => {
  it.live("is unasked until the person answers, and the first answer makes the install's ID", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      const before = yield* asApp(reportSettings, data);
      const on = yield* asApp(setReportChoices({ errorReports: true }), data);
      const off = yield* asApp(setReportChoices({ errorReports: false }), data);

      expect(before).toEqual({
        available: true,
        errorReports: Option.none(),
        usageStats: Option.none(),
        installId: Option.none(),
      });
      expect(on.errorReports).toEqual(Option.some(true));
      expect(Option.getOrThrow(on.installId)).toMatch(/^[0-9a-f-]{36}$/);
      expect(off.errorReports).toEqual(Option.some(false));
      expect(off.installId).toEqual(on.installId);
    }),
  );

  it.live("a new install ID leaves the earlier one behind", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      const first = yield* asApp(setReportChoices({ errorReports: true }), data);
      const renewed = yield* asApp(resetInstallId(), data);

      expect(Option.isSome(renewed.installId)).toBe(true);
      expect(renewed.installId).not.toEqual(first.installId);
      expect(renewed.errorReports).toEqual(Option.some(true));
    }),
  );

  it.live("feedback carries the install ID only with its log, while reports go", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      const unasked = yield* asApp(feedbackInstallId(true), data);
      const on = yield* asApp(setReportChoices({ errorReports: true }), data);
      const withLog = yield* asApp(feedbackInstallId(true), data);
      const withoutLog = yield* asApp(feedbackInstallId(false), data);

      yield* asApp(setReportChoices({ errorReports: false }), data);

      expect(unasked).toEqual(Option.none());
      expect(withLog).toEqual(on.installId);
      expect(withoutLog).toEqual(Option.none());
      expect(yield* asApp(feedbackInstallId(true), data)).toEqual(Option.none());
    }),
  );

  it.live("a build without the key has nothing to offer", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      expect((yield* asApp(reportSettings, data, { key: "" })).available).toBe(false);
    }),
  );
});

describe("sending error reports", () => {
  it.live("sends a failure as a PostHog exception, with the install ID and no profile", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const sent = yield* nothingSent();
      const settings = yield* asApp(setReportChoices({ errorReports: true }), data, { sent });

      yield* asApp(
        reported(
          Effect.logError(
            "render failed",
            new Error(`ffmpeg could not read ${HOME}/work/cut.mp4`),
          ).pipe(Effect.annotateLogs("operation", "render.run")),
        ),
        data,
        { sent },
      );

      expect(yield* Ref.get(sent)).toHaveLength(1);
      expect((yield* Ref.get(sent))[0]).toMatchObject({
        api_key: KEY,
        event: "$exception",
        distinct_id: Option.getOrThrow(settings.installId),
        properties: {
          $exception_list: [
            {
              type: "Error",
              value: "ffmpeg could not read ~/work/cut.mp4",
              mechanism: { handled: true },
            },
          ],
          $exception_fingerprint: "server:render.run:Error",
          $issue_name: "Error in render.run (server)",
          $process_person_profile: false,
          process: "server",
          operation: "render.run",
          app_version: APP_VERSION,
        },
      });
      expect(JSON.stringify((yield* Ref.get(sent))[0])).not.toContain(HOME);
    }),
  );

  it.live("names a failure by its tag and message, and sends each once", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const sent = yield* nothingSent();
      const broken = Effect.fn("items.get")(() => Effect.die(new TypeError("x is undefined")));

      yield* asApp(setReportChoices({ errorReports: true }), data, { sent });
      yield* asApp(
        reported(
          Effect.gen(function* () {
            yield* Effect.logError("first", new TypeError("x is undefined"));
            yield* Effect.logError("again", new TypeError("x is undefined"));
            yield* Effect.logWarning("not an error");
            yield* Effect.ignoreCause(broken());
          }),
        ),
        data,
        { sent },
      );

      expect(yield* Ref.get(sent)).toHaveLength(1);
      expect((yield* Ref.get(sent))[0]).toMatchObject({
        properties: {
          $exception_list: [{ type: "TypeError", value: "x is undefined" }],
          $issue_name: "TypeError (server)",
        },
      });
    }),
  );

  it.live("sends nothing before the person says yes, or after they say no", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const sent = yield* nothingSent();
      const fail = reported(Effect.logError("broke", new Error("broke")));

      yield* asApp(fail, data, { sent });
      yield* asApp(setReportChoices({ errorReports: false }), data, { sent });
      yield* asApp(fail, data, { sent });

      expect(yield* Ref.get(sent)).toEqual([]);
    }),
  );

  it.live("a build without the key adds nothing to the log", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      const sink = yield* asApp(Effect.provide(ErrorSink, errorReports("server")), data, {
        key: "",
      });

      expect(sink).toEqual(Option.none());
    }),
  );

  it.live("a top-level operation that fails is reported through the process's log", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const logs = yield* dataFolder;
      const sent = yield* nothingSent();

      const render = Effect.fn("render.run")(() =>
        Effect.fail(new CommandFailed({ message: "ffmpeg exited with 1" })),
      );

      yield* asApp(setReportChoices({ errorReports: true }), data, { sent });
      yield* asApp(
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.ignore(render());
            yield* settle;
          }).pipe(
            Effect.provide(
              logToFile("server").pipe(
                Layer.provide([errorReports("server"), Layer.succeed(LogDir, Option.some(logs))]),
              ),
            ),
          ),
        ),
        data,
        { sent },
      );

      expect(yield* Ref.get(sent)).toHaveLength(1);
      expect((yield* Ref.get(sent))[0]).toMatchObject({
        properties: {
          $exception_list: [{ type: "CommandFailed", value: "ffmpeg exited with 1" }],
          operation: "render.run",
        },
      });
    }),
  );
});

describe("usage statistics", () => {
  it.live("are asked apart from error reports, and one choice leaves the other as it was", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;

      yield* asApp(setReportChoices({ errorReports: true, usageStats: false }), data);
      const changed = yield* asApp(setReportChoices({ usageStats: true }), data);

      expect(changed.errorReports).toEqual(Option.some(true));
      expect(changed.usageStats).toEqual(Option.some(true));
    }),
  );

  it.live("count nothing until the person shares them, then only counts", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const sent = yield* nothingSent();

      yield* asApp(trackUsage("video_created", { template: true }), data, { sent });
      yield* asApp(setReportChoices({ errorReports: true, usageStats: false }), data, { sent });
      yield* asApp(trackUsage("video_created", { template: true }), data, { sent });
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([]);

      const settings = yield* asApp(setReportChoices({ usageStats: true }), data, { sent });

      yield* asApp(trackUsage("edit_requested", { versions: 3 }), data, { sent });
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([
        {
          api_key: KEY,
          event: "edit_requested",
          distinct_id: Option.getOrThrow(settings.installId),
          properties: {
            versions: 3,
            $process_person_profile: false,
            app_version: APP_VERSION,
            platform: process.platform,
          },
        },
      ]);
    }),
  );

  it.live("a build without the key counts nothing", () =>
    Effect.gen(function* () {
      const data = yield* dataFolder;
      const sent = yield* nothingSent();

      yield* asApp(setReportChoices({ usageStats: true }), data, { sent, key: "" });
      yield* asApp(trackUsage("take_kept"), data, { sent, key: "" });
      yield* settle;

      expect(yield* Ref.get(sent)).toEqual([]);
    }),
  );
});
