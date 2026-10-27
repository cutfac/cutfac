import { describe, expect } from "bun:test";
// Each test sends to a fake site of its own, with the environment and logs that test needs.
// @effect-diagnostics strictEffectProvide:off

import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path, Predicate } from "effect";
import { HttpClient, HttpClientResponse, type HttpBody } from "effect/http";

import { APP_VERSION } from "../src/core/build.ts";
import { MAX_FEEDBACK_LOG_CHARS, recentLogs } from "../src/core/feedbackLogs.ts";
import { LogDir } from "../src/core/logFile.ts";
import {
  MAX_TEAM_FEEDBACK_CHARS,
  TEAM_FEEDBACK_URL,
  sendTeamFeedback,
} from "../src/core/teamFeedback.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

/** What cutfac.com received: its fields, and the log file when one came. */
interface Sent {
  readonly url: string;
  readonly fields: ReadonlyMap<string, string>;
  readonly logs: Option.Option<File>;
}

/** The fields of a form the app posted, URL-encoded or multipart. */
async function received(url: string, body: HttpBody.HttpBody): Promise<Sent> {
  if (Predicate.isTagged(body, "FormData")) {
    const form = body.formData;

    const fields = [...form.entries()].flatMap(([name, value]) =>
      Predicate.isString(value) ? [[name, value] as const] : [],
    );

    const logs = form.get("logs");

    return {
      url,
      fields: new Map(fields),
      logs: Option.liftPredicate(logs, (file) => file instanceof File),
    };
  }

  const bytes = Predicate.isTagged(body, "Uint8Array") ? body.body : new Uint8Array();
  const text = new TextDecoder().decode(bytes);

  return { url, fields: new Map(new URLSearchParams(text)), logs: Option.none() };
}

/**
 * cutfac.com answering every request with `status`, recording what it got, in an environment of
 * just `env`, so a CUTFAC_FEEDBACK_URL in a checkout's `.env` changes nothing.
 */
const fakeSite = (status: number, sent: Sent[], env: Record<string, string> = {}) =>
  Layer.merge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) =>
        Effect.promise(async () => {
          sent.push(await received(url.href, request.body));

          return HttpClientResponse.fromWeb(request, new Response("", { status }));
        }),
      ),
    ),
    ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
  );

/** The tag of the error sending fails with. */
const sendError = (status: number, sent: Sent[], message: string, email?: string) =>
  sendTeamFeedback({ message, email, source: "slash", locale: "ko" }).pipe(
    Effect.provide(fakeSite(status, sent)),
    Effect.flip,
    Effect.map((error) => error._tag),
  );

/** A log folder with `files` in it, removed after the test. */
const logFolder = Effect.fnUntraced(function* (files: Record<string, string>) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-feedback-logs-" });

  yield* Effect.forEach(Object.entries(files), ([name, text]) =>
    fs.writeFileString(path.join(dir, name), text),
  );

  return dir;
});

describe("team feedback", () => {
  it.effect("posts the trimmed message with its context to cutfac.com", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];

      yield* sendTeamFeedback({
        message: "  Love it  ",
        source: "board",
        platform: "darwin",
        agent: "claude",
      }).pipe(Effect.provide(fakeSite(200, sent)));

      expect(sent[0]?.url).toBe(TEAM_FEEDBACK_URL);
      expect(sent[0]?.fields.get("message")).toBe("Love it");
      expect(sent[0]?.fields.get("source")).toBe("board");
      expect(sent[0]?.fields.get("platform")).toBe("darwin");
      expect(sent[0]?.fields.get("agent")).toBe("claude");
      expect(sent[0]?.logs).toEqual(Option.none());
    }),
  );

  it.effect("stamps this build's version, marked -dev from source", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];

      yield* sendTeamFeedback({ message: "hi", source: "agent" }).pipe(
        Effect.provide(fakeSite(200, sent)),
      );

      expect(APP_VERSION).toEndWith("-dev");
      expect(sent[0]?.fields.get("version")).toBe(APP_VERSION);
    }),
  );

  it.effect("CUTFAC_FEEDBACK_URL sends it somewhere else, such as a local copy of the site", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];

      const site = fakeSite(200, sent, {
        CUTFAC_FEEDBACK_URL: "http://localhost:3000/api/feedback",
      });

      yield* sendTeamFeedback({ message: "hi", source: "board" }).pipe(Effect.provide(site));

      expect(sent[0]?.url).toBe("http://localhost:3000/api/feedback");
    }),
  );

  it.effect("stops empty or oversized feedback before sending", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];

      expect(yield* sendError(200, sent, "   ")).toBe("InvalidRequest");
      expect(yield* sendError(200, sent, "a".repeat(MAX_TEAM_FEEDBACK_CHARS + 1))).toBe(
        "InvalidRequest",
      );
      expect(sent).toHaveLength(0);
    }),
  );

  it.effect("maps the site's answers to errors", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];

      expect(yield* sendError(400, sent, "hi", "nope")).toBe("InvalidRequest");
      expect(yield* sendError(503, sent, "hi")).toBe("FetchFailed");
      expect(sent[0]?.fields.get("email")).toBe("nope");
    }),
  );
});

describe("feedback with the app's log", () => {
  it.effect("attaches the recent log, gzipped, beside the same fields", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];
      const dir = yield* logFolder({ "server-2026-10-28.log": '{"message":"render failed"}\n' });

      yield* sendTeamFeedback({ message: "It broke", source: "board", withLogs: true }).pipe(
        Effect.provide(fakeSite(200, sent)),
        Effect.provideService(LogDir, Option.some(dir)),
      );

      const file = Option.getOrThrow(sent[0]?.logs ?? Option.none());

      const text = new TextDecoder().decode(
        Bun.gunzipSync(new Uint8Array(yield* Effect.promise(() => file.arrayBuffer()))),
      );

      expect(sent[0]?.fields.get("message")).toBe("It broke");
      expect(sent[0]?.fields.get("version")).toBe(APP_VERSION);
      expect(file.name).toBe("cutfac-logs.txt.gz");
      expect(text).toBe('# server-2026-10-28.log\n{"message":"render failed"}\n');
    }),
  );

  it.effect("sends no file when the person said no, or there is no log", () =>
    Effect.gen(function* () {
      const sent: Sent[] = [];
      const dir = yield* logFolder({ "server-2026-10-28.log": "line\n" });

      yield* sendTeamFeedback({ message: "hi", source: "board", withLogs: false }).pipe(
        Effect.provide(fakeSite(200, sent)),
        Effect.provideService(LogDir, Option.some(dir)),
      );
      yield* sendTeamFeedback({ message: "hi", source: "board", withLogs: true }).pipe(
        Effect.provide(fakeSite(200, sent)),
      );

      expect(sent.map(({ logs }) => Option.isSome(logs))).toEqual([false, false]);
    }),
  );

  it.effect("keeps the newest days, oldest first, cut to fit", () =>
    Effect.gen(function* () {
      const older = Array.from({ length: 30_000 }, (_, n) => `old line ${n}`).join("\n");
      const newer = Array.from({ length: 60_000 }, (_, n) => `new line ${n}`).join("\n");

      const dir = yield* logFolder({
        "app-2026-10-20.log": "never read\n",
        "app-2026-10-27.log": `${older}\n`,
        "server-2026-10-28.log": `${newer}\n`,
        "notes.txt": "not a log\n",
      });

      const logs = Option.getOrThrow(
        yield* recentLogs.pipe(Effect.provideService(LogDir, Option.some(dir))),
      );

      expect(logs.length).toBeLessThanOrEqual(MAX_FEEDBACK_LOG_CHARS + 100);
      expect(logs.indexOf("# app-2026-10-27.log")).toBe(0);
      expect(logs.indexOf("# server-2026-10-28.log")).toBeGreaterThan(0);
      expect(logs).toEndWith("new line 59999\n");
      expect(logs).not.toContain("never read");
      expect(logs).not.toContain("not a log");
      // The oldest kept day starts on a whole line.
      expect(logs.split("\n")[1]).toMatch(/^old line \d+$/);
    }),
  );
});
