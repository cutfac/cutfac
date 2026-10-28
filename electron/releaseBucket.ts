import path from "node:path";

import { Context, Effect, FileSystem, Layer, Option, Redacted, Result } from "effect";

import { describeError } from "../src/core/errors.ts";
import {
  type BuildFile,
  buildFiles,
  feedVersion,
  log,
  ReleaseFailed,
  releaseSetting,
  type ReleaseSetting,
} from "./releasePlan.ts";

/** The bucket folder the site serves builds from. */
const FOLDER = "mac";

const FEED_FILE = "latest-mac.yml";

const setting = (name: ReleaseSetting) =>
  releaseSetting(name).pipe(
    Effect.flatMap(
      Effect.fromOption(() => new ReleaseFailed({ message: `Set ${name} in .env.release.` })),
    ),
  );

const failed = (what: string) => (cause: unknown) =>
  new ReleaseFailed({
    message: `${what}: ${describeError(cause)}`,
  });

export class ReleaseBucket extends Context.Service<
  ReleaseBucket,
  {
    readonly publishedVersion: Effect.Effect<Option.Option<string>, ReleaseFailed>;
    upload(file: BuildFile, source: string): Effect.Effect<void, ReleaseFailed>;
  }
>()("cutfac/release/ReleaseBucket") {
  static readonly layer = Layer.effect(
    ReleaseBucket,
    Effect.gen(function* () {
      const s3 = new Bun.S3Client({
        bucket: Redacted.value(yield* setting("CUTFAC_RELEASES_BUCKET")),
        region: Redacted.value(yield* setting("CUTFAC_RELEASES_REGION")),
        accessKeyId: Redacted.value(yield* setting("AWS_ACCESS_KEY_ID")),
        secretAccessKey: Redacted.value(yield* setting("AWS_SECRET_ACCESS_KEY")),
      });

      const publishedVersion = Effect.tryPromise({
        try: async () => {
          const feed = s3.file(`${FOLDER}/${FEED_FILE}`);

          return (await feed.exists()) ? Option.some(await feed.text()) : Option.none<string>();
        },
        catch: failed(`Couldn't read ${FOLDER}/${FEED_FILE} in the bucket`),
      }).pipe(Effect.map(Option.flatMap(feedVersion)));

      const upload = ({ name, type }: BuildFile, source: string) =>
        Effect.tryPromise({
          try: () => s3.write(`${FOLDER}/${name}`, Bun.file(source), { type }),
          catch: failed(`Couldn't upload ${name}`),
        });

      return ReleaseBucket.of({ publishedVersion, upload });
    }),
  );
}

/** Uploads `version`'s build from `folder`, the feed that makes it live last. */
export const publishBuild = Effect.fn("publishBuild")(function* (folder: string, version: string) {
  const fs = yield* FileSystem.FileSystem;
  const bucket = yield* ReleaseBucket;
  const feed = yield* fs.readFileString(path.join(folder, FEED_FILE)).pipe(Effect.option);

  if (!Option.contains(Option.flatMap(feed, feedVersion), version)) {
    return yield* new ReleaseFailed({
      message: `The build did not produce a ${FEED_FILE} for ${version}.`,
    });
  }

  const builds = buildFiles(version, yield* fs.readDirectory(folder));

  if (Result.isFailure(builds)) return yield* new ReleaseFailed({ message: builds.failure });

  const upload = (file: BuildFile) =>
    Effect.andThen(
      log(`Uploading ${file.name}.`),
      bucket.upload(file, path.join(folder, file.name)),
    );

  yield* Effect.forEach(builds.success, upload, { discard: true });
  yield* upload({ name: FEED_FILE, type: "text/yaml" });
  yield* log(`Published ${version}. cutfac.com/download now hands it out.`);
});
