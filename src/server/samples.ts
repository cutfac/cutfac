import { Effect, Schema } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { addSample, listSamples, SAMPLE_LANGUAGES, samplePreview } from "../samples.ts";
import { itemDetail } from "./items.ts";
import { json, raw } from "./respond.ts";

const Language = Schema.Literals(SAMPLE_LANGUAGES);

const SampleQuery = Schema.Struct({ lang: Language });

const PreviewQuery = Schema.Struct({ id: Schema.NonEmptyString, lang: Language });

const NewSampleBody = Schema.Struct({
  id: Schema.NonEmptyString,
  lang: Language,
  title: Schema.NonEmptyString,
});

export const sampleRoutes = HttpRouter.addAll([
  json(
    "GET",
    "/api/samples",
    Effect.flatMap(HttpServerRequest.schemaSearchParams(SampleQuery), ({ lang }) =>
      listSamples(lang),
    ),
  ),
  raw(
    "GET",
    "/api/samples/preview",
    Effect.gen(function* () {
      const { id, lang } = yield* HttpServerRequest.schemaSearchParams(PreviewQuery);

      return yield* HttpServerResponse.file(yield* samplePreview(id, lang), {
        contentType: "video/mp4",
        headers: { "cache-control": "max-age=3600" },
      });
    }),
  ),
  json(
    "POST",
    "/api/samples",
    Effect.flatMap(HttpServerRequest.schemaBodyJson(NewSampleBody), ({ id, lang, title }) =>
      Effect.flatMap(addSample(id, lang, title), itemDetail),
    ),
  ),
]);
