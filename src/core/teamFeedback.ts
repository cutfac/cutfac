import { Config, Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { APP_VERSION } from "./build.ts";
import { FetchFailed, InvalidRequest } from "./errors.ts";

/**
 * Feedback for the people who make Cutfac, as opposed to the feedback a person leaves on an item
 * for their agent. cutfac.com mails it to the team.
 */
export const TEAM_FEEDBACK_URL = "https://cutfac.com/api/feedback";

/** `CUTFAC_FEEDBACK_URL` points a checkout at a local copy of the site, so trying it mails no one. */
const FeedbackUrl = Config.String("CUTFAC_FEEDBACK_URL");

/** The site gives up on its mail provider well before this, so a longer wait means it is down. */
const SEND_TIMEOUT = "20 seconds";

/** The site turns away longer messages, so they are stopped here with a clearer error. */
export const MAX_TEAM_FEEDBACK_CHARS = 5000;

/** Which way in the feedback came. */
export type TeamFeedbackSource = "board" | "slash" | "agent";

export interface TeamFeedback {
  readonly message: string;
  /** Where the team can reply, when the person wants an answer. */
  readonly email?: string | undefined;
  readonly source: TeamFeedbackSource;
  readonly platform?: string | undefined;
  readonly locale?: string | undefined;
  /** The agent the person works with, such as "claude-code 2.1.0". */
  readonly agent?: string | undefined;
}

/**
 * Sends feedback to the Cutfac team, with the version of this app, so the team knows which build
 * it is about. The site's field names are a public contract: add new ones, never rename them.
 */
export const sendTeamFeedback = Effect.fn("teamFeedback.send")(function* (feedback: TeamFeedback) {
  const url = yield* Effect.orElseSucceed(FeedbackUrl, () => TEAM_FEEDBACK_URL);
  const message = feedback.message.trim();

  if (message === "") return yield* new InvalidRequest({ message: "The feedback is empty." });

  if (message.length > MAX_TEAM_FEEDBACK_CHARS)
    return yield* new InvalidRequest({
      message: `Feedback can be at most ${MAX_TEAM_FEEDBACK_CHARS} characters; this is ${message.length}.`,
    });

  const request = HttpClientRequest.post(url).pipe(
    HttpClientRequest.bodyUrlParams({
      message,
      email: feedback.email?.trim() ?? "",
      source: feedback.source,
      version: APP_VERSION,
      platform: feedback.platform ?? "",
      locale: feedback.locale ?? "",
      agent: feedback.agent ?? "",
    }),
  );

  const response = yield* HttpClient.execute(request).pipe(
    Effect.mapError((error) => new FetchFailed({ message: `${url}: ${error.message}` })),
    Effect.timeoutOrElse({
      duration: SEND_TIMEOUT,
      orElse: () => Effect.fail(new FetchFailed({ message: `${url} did not answer in time.` })),
    }),
  );

  if (response.status === 400)
    return yield* new InvalidRequest({
      message: "cutfac.com turned the feedback away; check the reply address.",
    });

  if (response.status !== 200)
    return yield* new FetchFailed({
      message: `cutfac.com could not take the feedback right now (${response.status}).`,
    });
});
