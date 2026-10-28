import { Effect, Option, Schema } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";

import { readAbout } from "../core/about.ts";
import { forget, learn, learnInputOf, listLearned } from "../core/learn.ts";
import { json, withId } from "./respond.ts";
import { isMultipart, MediaForm } from "./uploads.ts";

const LearnBody = Schema.Struct({ source: Schema.NonEmptyString });

/** Everything learned, newest first, with about.md as agents read it. */
const learnedList = Effect.all(
  { learned: listLearned(), about: Effect.map(readAbout(), Option.getOrUndefined) },
  { concurrency: "unbounded" },
);

export const learnedRoutes = HttpRouter.addAll([
  json("GET", "/api/learned", learnedList),
  json(
    "POST",
    "/api/learn",
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;

      if (isMultipart(request)) {
        const { file } = yield* HttpServerRequest.schemaBodyMultipart(MediaForm);

        return yield* learn({ file: file.path, name: file.name });
      }

      const body = yield* HttpServerRequest.schemaBodyJson(LearnBody);

      return yield* learn(learnInputOf(body.source));
    }),
  ),
  json("POST", "/api/learned/forget", Effect.andThen(withId(forget), learnedList)),
]);
