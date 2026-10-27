import { Effect, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { APP_VERSION } from "./core/build.ts";
import { REPORTS_URL, ReportKey, reportSettings } from "./errorReports.ts";

// The desktop app's usage statistics: which of its parts get used, never what is made with them.
// They go to the same PostHog project as error reports, under the same install ID, and only once
// the person says yes; only a release build carries the key to send them with.

/** Everything usage statistics count. Each says that something was done, never what it was about. */
export const USAGE_EVENTS = [
  /** The first launch's steps came to an end. */
  "onboarding_finished",
  /** A video was made on the board. */
  "video_created",
  /** An edit was asked for on the board, as one version or several to compare. */
  "edit_requested",
  /** One of several versions was kept. */
  "take_kept",
] as const;

export type UsageEvent = (typeof USAGE_EVENTS)[number];

/** Counts and switches only: nothing a person wrote, no names and no paths. */
export type UsageProperties = Readonly<Record<string, number | boolean>>;

const USAGE_TIMEOUT = "10 seconds";

/**
 * Counts `event`, if this build can send and the person sends usage statistics now. It never
 * fails and never waits on PostHog: a count that can't go is dropped.
 */
export const trackUsage = (event: UsageEvent, properties: UsageProperties = {}) =>
  Effect.gen(function* () {
    const key = yield* ReportKey;

    if (Option.isNone(key)) return;

    const settings = yield* reportSettings;

    if (!Option.getOrElse(settings.usageStats, () => false)) return;

    if (Option.isNone(settings.installId)) return;

    yield* HttpClientRequest.post(REPORTS_URL).pipe(
      HttpClientRequest.bodyJsonUnsafe({
        api_key: key.value,
        event,
        distinct_id: settings.installId.value,
        properties: {
          ...properties,
          $process_person_profile: false,
          app_version: APP_VERSION,
          platform: process.platform,
        },
      }),
      HttpClient.execute,
      Effect.timeout(USAGE_TIMEOUT),
      Effect.ignore,
    );
  }).pipe(Effect.ignore, Effect.forkDetach, Effect.asVoid);
