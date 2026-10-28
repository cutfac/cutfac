import { Context, Effect, Option, Path, Schema } from "effect";

import { COMPILED } from "./core/build.ts";
import { InvalidRequest, NotFound } from "./core/errors.ts";
import { getItem } from "./core/items.ts";
import { Workspace } from "./core/workspace.ts";
import { createSampleItem } from "./plan.ts";

/**
 * The app's sample videos: each a short motion graphic made with code, which a new user copies into
 * their workspace to try editing before they make their own. The desktop app keeps them beside its
 * binary; from source they are the checkout's `samples/`.
 */
export const SamplesDir = Context.Reference<string>("cutfac/SamplesDir", {
  defaultValue: () =>
    COMPILED
      ? `${process.execPath.replace(/\/bin\/[^/]+$/, "")}/samples`
      : `${import.meta.dir}/../samples`,
});

export const SAMPLE_LANGUAGES = ["en", "ko"] as const;

export type SampleLanguage = (typeof SAMPLE_LANGUAGES)[number];

const Manifest = Schema.fromJsonString(
  Schema.Struct({
    /** The code every sample renders with, beside its own page. */
    files: Schema.Array(Schema.NonEmptyString),
    samples: Schema.Array(
      Schema.Struct({ id: Schema.NonEmptyString, fonts: Schema.Array(Schema.NonEmptyString) }),
    ),
  }),
);

/** What a sample says, read for its title. */
const Copy = Schema.fromJsonString(Schema.Struct({ title: Schema.String }));

const SMALL_FILE_BYTES = 64 * 1024;

export interface Sample {
  readonly id: string;
  readonly title: string;
}

/** The samples this build has, in order; none when it was built without them, as the CLI is. */
const manifest = Effect.gen(function* () {
  const ws = yield* Workspace;
  const dir = yield* SamplesDir;
  const text = yield* Effect.option(ws.peekText(`${dir}/samples.json`, SMALL_FILE_BYTES));

  if (Option.isNone(text)) return { files: [], samples: [] };

  return yield* Schema.decodeEffect(Manifest)(text.value);
});

const copyFile = (dir: string, id: string, lang: SampleLanguage) =>
  `${dir}/${id}/copy.${lang}.json`;

/** Each sample, titled in `lang`. */
export const listSamples = Effect.fn("samples.list")(function* (lang: SampleLanguage) {
  const ws = yield* Workspace;
  const dir = yield* SamplesDir;

  return yield* Effect.forEach((yield* manifest).samples, ({ id }) =>
    Effect.map(
      Effect.flatMap(
        ws.peekText(copyFile(dir, id, lang), SMALL_FILE_BYTES),
        Schema.decodeEffect(Copy),
      ),
      ({ title }): Sample => ({ id, title }),
    ),
  );
});

/** The sample's rendered video in `lang`, for the board to preview. */
export const samplePreview = Effect.fn("samples.preview")(function* (
  id: string,
  lang: SampleLanguage,
) {
  const dir = yield* SamplesDir;

  if (!(yield* manifest).samples.some((sample) => sample.id === id)) {
    return yield* new NotFound({ message: `No sample named ${id}` });
  }

  return `${dir}/${id}/preview.${lang}.mp4`;
});

const notes = (media: string) =>
  [
    "One of Cutfac's samples, a motion graphic made with code, for the user to try editing.",
    "Its words are in src/copy.json, and its look, motion and sound in src/index.html, a canvas",
    "drawn as a pure function of time with helpers in src/motion.js; its fonts are in src/fonts.",
    `Render it with \`node src/render.mjs\` from this folder, which writes \`${media}\`. That`,
    "needs Node, Playwright and its Chromium (`npm install` and `npx playwright install chromium`",
    "in src/), and ffmpeg: install what is missing first.",
  ].join(" ");

/**
 * Copy the sample `id` into the workspace as a new video titled `title`, with its words in `lang`.
 * It is practice, so it uses none of the free version's videos, now or as work on it goes on.
 */
export const addSample = Effect.fn("samples.add")(function* (
  id: string,
  lang: SampleLanguage,
  title: string,
) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const dir = yield* SamplesDir;
  const { files: shared, samples } = yield* manifest;
  const sample = samples.find((entry) => entry.id === id);

  if (sample === undefined) return yield* new InvalidRequest({ message: `No sample named ${id}` });

  const media = `[9x16] ${id}.mp4`;
  const item = yield* createSampleItem({ title, id: `sample-${id}`, notes: notes(media) });

  const files: ReadonlyArray<readonly [string, string]> = [
    [`${dir}/${id}/preview.${lang}.mp4`, media],
    [`${dir}/${id}/index.html`, "src/index.html"],
    [copyFile(dir, id, lang), "src/copy.json"],
    ...shared.map((file) => [`${dir}/${file}`, `src/${file}`] as const),
    ...sample.fonts.map((font) => [`${dir}/fonts/${font}`, `src/fonts/${font}`] as const),
  ];

  yield* Effect.forEach(files, ([from, to]) => ws.importFile(from, path.join(item.dir, to)), {
    discard: true,
  }).pipe(Effect.onError(() => Effect.ignore(ws.remove(item.dir))));

  return yield* getItem(item.id);
});
