import { describe, expect, test } from "bun:test";
// @effect-diagnostics strictEffectProvide:off

import { ConfigProvider, Effect, Layer, Predicate } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { APP_VERSION } from "../src/core/build.ts";
import {
  MAX_TEAM_FEEDBACK_CHARS,
  TEAM_FEEDBACK_URL,
  sendTeamFeedback,
} from "../src/core/teamFeedback.ts";

interface Sent {
  readonly url: string;
  readonly body: URLSearchParams;
}

/**
 * An HttpClient that answers every request with `status` and records what was posted. The
 * environment holds only `env`, so a CUTFAC_FEEDBACK_URL in a checkout's `.env` changes nothing.
 */
const fakeSite = (status: number, sent: Sent[], env: Record<string, string> = {}) =>
  Layer.merge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request, url) =>
        Effect.sync(() => {
          const body = Predicate.isTagged(request.body, "Uint8Array")
            ? request.body.body
            : new Uint8Array();

          sent.push({ url: url.href, body: new URLSearchParams(new TextDecoder().decode(body)) });

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
    Effect.runPromise,
  );

describe("team feedback", () => {
  test("posts the trimmed message with its context to cutfac.com", async () => {
    const sent: Sent[] = [];

    await sendTeamFeedback({
      message: "  Love it  ",
      source: "board",
      platform: "darwin",
      agent: "claude",
    }).pipe(Effect.provide(fakeSite(200, sent)), Effect.runPromise);

    expect(sent[0]?.url).toBe(TEAM_FEEDBACK_URL);
    expect(sent[0]?.body.get("message")).toBe("Love it");
    expect(sent[0]?.body.get("source")).toBe("board");
    expect(sent[0]?.body.get("platform")).toBe("darwin");
    expect(sent[0]?.body.get("agent")).toBe("claude");
  });

  test("stamps this build's version, marked -dev from source", async () => {
    const sent: Sent[] = [];

    await sendTeamFeedback({ message: "hi", source: "agent" }).pipe(
      Effect.provide(fakeSite(200, sent)),
      Effect.runPromise,
    );

    expect(APP_VERSION).toEndWith("-dev");
    expect(sent[0]?.body.get("version")).toBe(APP_VERSION);
  });

  test("CUTFAC_FEEDBACK_URL sends it somewhere else, such as a local copy of the site", async () => {
    const sent: Sent[] = [];

    const site = fakeSite(200, sent, { CUTFAC_FEEDBACK_URL: "http://localhost:3000/api/feedback" });

    await sendTeamFeedback({ message: "hi", source: "board" }).pipe(
      Effect.provide(site),
      Effect.runPromise,
    );

    expect(sent[0]?.url).toBe("http://localhost:3000/api/feedback");
  });

  test("stops empty or oversized feedback before sending", async () => {
    const sent: Sent[] = [];

    const empty = await sendError(200, sent, "   ");
    const long = await sendError(200, sent, "a".repeat(MAX_TEAM_FEEDBACK_CHARS + 1));

    expect(empty).toBe("InvalidRequest");
    expect(long).toBe("InvalidRequest");
    expect(sent).toHaveLength(0);
  });

  test("maps the site's answers to errors", async () => {
    const sent: Sent[] = [];

    const refused = await sendError(400, sent, "hi", "nope");
    const down = await sendError(503, sent, "hi");

    expect(refused).toBe("InvalidRequest");
    expect(down).toBe("FetchFailed");
    expect(sent[0]?.body.get("email")).toBe("nope");
  });
});
