import { Schema } from "effect";

import type { Locale } from "../i18n/locale.ts";
import { request, send } from "./client.ts";
import { ItemDetail } from "./items.ts";

export const Sample = Schema.Struct({ id: Schema.String, title: Schema.String });

export type Sample = typeof Sample.Type;

export const samplePreviewUrl = (id: string, lang: Locale) =>
  `/api/samples/preview?id=${encodeURIComponent(id)}&lang=${lang}`;

export const sampleApi = {
  samples: (lang: Locale) => request(Schema.Array(Sample), `/api/samples?lang=${lang}`),
  addSample: (input: { id: string; lang: Locale; title: string }) =>
    send(ItemDetail, "POST", "/api/samples", input),
};
