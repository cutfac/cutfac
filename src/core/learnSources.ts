import { Effect, Option, Path } from "effect";

import { InvalidRequest } from "./errors.ts";
import { type Found, type LearnResult, saveLearned } from "./learnedEntry.ts";
import { summarize } from "./learnText.ts";
import { detectSource, download, fetchListing, type Listing, MAX_SCREENSHOTS } from "./listings.ts";
import { extension, mediaKind, probe } from "./media.ts";
import { downloadVideo, preprocessVideo } from "./preprocess.ts";
import { type ItemSource } from "./schema.ts";
import { cleanPath, cleanUrl } from "./sources.ts";
import { isVideoLink } from "./videoLinks.ts";
import { Workspace } from "./workspace.ts";

/** Enough of a README or note for its title and first paragraph. */
const TEXT_BYTES = 64 * 1024;

const README = /^readme(\.(md|markdown|txt))?$/i;

const TEXT_FILE = new Set(["md", "markdown", "txt"]);

/** `effect`, or `fallback` and a warning saying why if it fails. */
const orWarn = <A, E extends { readonly message: string }, R, B>(
  effect: Effect.Effect<A, E, R>,
  warnings: Array<string>,
  label: string,
  fallback: B,
) =>
  Effect.catch(effect, (error) =>
    Effect.sync(() => {
      warnings.push(`${label}: ${error.message}`);

      return fallback;
    }),
  );

export const learnLink = Effect.fn("learn.learnLink")(function* (given: string) {
  const url = yield* cleanUrl(given);
  const warnings: Array<string> = [];
  const store = detectSource(url) !== "web";
  const video = !store && isVideoLink(url);

  // A video's page is a bonus; without it yt-dlp still finds the title.
  const listing = video
    ? yield* orWarn(fetchListing(url), warnings, "Could not read the page", undefined)
    : yield* fetchListing(url);

  const title = listing?.title ?? listing?.name ?? new URL(url).hostname;

  const learned = yield* saveLearned(title, (dir) =>
    Effect.gen(function* () {
      const saved = video ? yield* saveVideo(url, dir, listing, warnings) : undefined;

      const pictures =
        listing === undefined ? undefined : yield* savePictures(listing, dir, warnings);

      const site = listing?.developer ?? (listing?.name === title ? undefined : listing?.name);

      const found: Found = {
        doc: {
          kind: store ? "app" : saved === undefined ? "page" : "video",
          title: saved?.title ?? title,
          description: (store ? listing?.description : listing?.summary) ?? "",
          source: { url },
          site,
          icon: pictures?.icon,
          images: pictures?.images ?? [],
          video: saved?.video,
          probe: saved?.probe,
          links: Object.values(listing?.links ?? {}).filter((link) => link !== undefined),
        },
        preprocess: saved?.preprocess,
      };

      return found;
    }),
  );

  const result: LearnResult = { learned, warnings };

  return result;
});

/**
 * Download a video link and preprocess it. Without yt-dlp, or when it fails, a link whose page could
 * be read is kept as a page.
 */
const saveVideo = Effect.fn("learn.saveVideo")(function* (
  url: string,
  dir: string,
  listing: Listing | undefined,
  warnings: Array<string>,
) {
  const attempt =
    listing === undefined
      ? downloadVideo(url, dir)
      : orWarn(downloadVideo(url, dir), warnings, "Saved as a page without the video", undefined);

  const downloaded = yield* attempt;

  if (downloaded === undefined) return undefined;
  const looked = yield* lookAtVideo(dir, downloaded.video, warnings);

  return {
    ...looked,
    video: downloaded.video,
    title: listing === undefined ? downloaded.title : undefined,
  };
});

/** An app's icon and screenshots, or a page's icon and the picture it shares itself with. */
const savePictures = Effect.fn("learn.savePictures")(function* (
  listing: Listing,
  dir: string,
  warnings: Array<string>,
) {
  const saveOne = (url: string, stem: string) =>
    orWarn(
      Effect.map(download(url, `${dir}/${stem}`), (file) => file.slice(dir.length + 1)),
      warnings,
      `Could not download ${url}`,
      undefined,
    );

  const assets = [
    ...(listing.icon === undefined ? [] : [{ url: listing.icon, stem: "icon" }]),
    ...(listing.image === undefined ? [] : [{ url: listing.image, stem: "image" }]),
    ...listing.screenshots
      .slice(0, MAX_SCREENSHOTS)
      .map((url, index) => ({ url, stem: `shot-${String(index + 1).padStart(2, "0")}` })),
  ];

  const saved = yield* Effect.forEach(assets, (asset) => saveOne(asset.url, asset.stem), {
    concurrency: 4,
  });

  const files = saved.filter((file) => file !== undefined);

  return {
    icon: files.find((file) => file.startsWith("icon.")),
    images: files.filter((file) => !file.startsWith("icon.")),
  };
});

/** Probe and preprocess a video saved in `dir`; if that fails the video stays and a warning says why. */
const lookAtVideo = (dir: string, video: string, warnings: Array<string>) =>
  orWarn(
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const info = yield* probe(yield* ws.abs(`${dir}/${video}`));
      const preprocess = yield* preprocessVideo(dir, video, info);
      const { duration, width, height, fps, hasAudio } = info;

      return { probe: { duration, width, height, fps, hasAudio }, preprocess };
    }),
    warnings,
    `Could not preprocess ${video}`,
    { probe: undefined, preprocess: undefined },
  );

export const learnPath = Effect.fn("learn.learnPath")(function* (given: string) {
  const ws = yield* Workspace;
  const path = yield* Path.Path;
  const cleaned = yield* cleanPath(given);
  const full = path.resolve(ws.root, cleaned);

  const seen = yield* ws
    .peek(full)
    .pipe(Effect.mapError(() => new InvalidRequest({ message: `Nothing to read at ${full}` })));

  if (!seen.dir) return yield* learnFile(full, path.basename(full), { path: cleaned });
  const readme = seen.names.find((name) => README.test(name));

  const text =
    readme === undefined
      ? ""
      : yield* ws
          .peekText(path.join(full, readme), TEXT_BYTES)
          .pipe(Effect.orElseSucceed(() => ""));

  const { title, description } = summarize(text);
  const name = title ?? path.basename(full);

  const learned = yield* saveLearned(name, () =>
    Effect.succeed<Found>({
      doc: {
        kind: "folder",
        title: name,
        description,
        source: { path: cleaned },
        images: [],
        links: [],
      },
    }),
  );

  const result: LearnResult = { learned, warnings: [] };

  return result;
});

/**
 * A file at `full`. Videos and pictures are copied in so the board can show them, and videos are
 * preprocessed; other files stay where they are unless uploaded (`source` undefined), since an
 * upload's temporary copy goes away.
 */
export const learnFile = Effect.fn("learn.learnFile")(function* (
  full: string,
  name: string,
  source: ItemSource | undefined,
) {
  const ws = yield* Workspace;
  const ext = extension(name);
  const kind = Option.getOrUndefined(mediaKind(name));
  const warnings: Array<string> = [];

  const text = TEXT_FILE.has(ext)
    ? yield* ws.peekText(full, TEXT_BYTES).pipe(Effect.orElseSucceed(() => ""))
    : "";

  const summary = summarize(text);
  const title = summary.title ?? name.replace(/\.[^.]+$/, "");

  const learned = yield* saveLearned(title, (dir) =>
    Effect.gen(function* () {
      const doc = {
        kind: "file",
        title,
        description: summary.description,
        source,
        images: [],
        links: [],
      } satisfies Found["doc"];

      if (kind === "video") {
        const video = `source.${ext}`;
        yield* ws.importFile(full, `${dir}/${video}`);
        const looked = yield* lookAtVideo(dir, video, warnings);

        const found: Found = {
          doc: { ...doc, kind: "video", video, probe: looked.probe },
          preprocess: looked.preprocess,
        };

        return found;
      }

      if (kind === "image") {
        const image = `image.${ext}`;
        yield* ws.importFile(full, `${dir}/${image}`);
        const found: Found = { doc: { ...doc, images: [image] } };

        return found;
      }

      if (source === undefined) {
        yield* ws.importFile(full, `${dir}/${/^[a-z\d]{1,8}$/.test(ext) ? `file.${ext}` : "file"}`);
      }

      const found: Found = { doc };

      return found;
    }),
  );

  const result: LearnResult = { learned, warnings };

  return result;
});
