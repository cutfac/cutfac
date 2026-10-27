import { Effect, Option, Path } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { isSimpleId, readOptionalText } from "./library.ts";
import {
  detectSource,
  download,
  fetchListing,
  type Listing,
  MAX_SCREENSHOTS,
  shortName,
} from "./listings.ts";
import { extension, mediaKind, probe } from "./media.ts";
import { downloadVideo, preprocessVideo, readPreprocess } from "./preprocess.ts";
import { type ItemSource, LearnedDoc, type PreprocessResult } from "./schema.ts";
import { cleanPath, cleanUrl } from "./sources.ts";
import { isVideoLink } from "./videoLinks.ts";
import { Workspace, type WorkspaceService, foldersWith, nowIso, slugify } from "./workspace.ts";

/** What the workspace makes videos about, in the workspace root. Agents read it; anyone edits it. */
export const ABOUT_FILE = "about.md";

export const LEARNED_FILE = "learned.yaml";

const ABOUT_HEADER =
  "# About\n\nWhat this workspace makes videos about. Agents read this file before they work; anyone can edit it.\n";

/** Starts the line a new section carries until an agent has read its source. */
export const UNREAD = "> Not read yet";

const UNREAD_LINE = `${UNREAD}: an agent should read the source, rewrite this section with what matters for the videos, and delete this line.`;

const marker = (id: string) => `<!-- learned:${id} -->`;

const MARKER = /^<!-- learned:(\S+) -->$/;

/** How much of a description goes into about.md; learned.yaml keeps all of it. */
const SECTION_TEXT = 1200;

const SUMMARY_TEXT = 500;

/** Enough of a README or note for its title and first paragraph. */
const TEXT_BYTES = 64 * 1024;

const README = /^readme(\.(md|markdown|txt))?$/i;

const TEXT_FILE = new Set(["md", "markdown", "txt"]);

/** A link, a file or folder on this computer, or an uploaded file at a temporary path. */
export type LearnInput =
  | { readonly url: string }
  | { readonly path: string }
  | { readonly file: string; readonly name: string };

const SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/** Read what a user or agent typed: a link (`www.` is enough), or else a path. */
export function learnInputOf(text: string): LearnInput {
  const given = text.trim();

  if (SCHEME.test(given)) return { url: given };

  return /^www\./i.test(given) ? { url: `https://${given}` } : { path: given };
}

export interface Learned {
  readonly id: string;
  /** Workspace-relative folder holding learned.yaml and whatever was saved from the source. */
  readonly dir: string;
  readonly doc: LearnedDoc;
  /** Whether about.md still says no agent has read the source. */
  readonly unread: boolean;
  readonly preprocess?: PreprocessResult | undefined;
}

export interface LearnResult {
  readonly learned: Learned;
  readonly warnings: ReadonlyArray<string>;
}

/** What a first look found, before learned.yaml gets its date. */
interface Found {
  readonly doc: Omit<LearnedDoc, "addedAt">;
  readonly preprocess?: PreprocessResult | undefined;
}

export const learnedDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.learned}/${id}`;

/** Learn a link, a path, or an upload: save what a first look finds and add it to about.md. */
export const learn = Effect.fn("learn.learn")(function* (input: LearnInput) {
  if ("url" in input) return yield* learnLink(input.url);

  if ("path" in input) return yield* learnPath(input.path);

  return yield* learnFile(input.file, input.name, undefined);
});

export const listLearned = Effect.fn("learn.listLearned")(function* () {
  const ws = yield* Workspace;
  const ids = yield* foldersWith(ws.config.paths.learned, LEARNED_FILE);
  const unread = yield* unreadIds;

  const entries = yield* Effect.forEach(
    ids,
    (id) =>
      Effect.map(
        ws.readYaml(`${learnedDir(ws, id)}/${LEARNED_FILE}`, LearnedDoc),
        (doc): Learned => ({ id, dir: learnedDir(ws, id), doc, unread: unread.has(id) }),
      ),
    { concurrency: 8 },
  );

  return entries.toSorted((a, b) => b.doc.addedAt.localeCompare(a.doc.addedAt));
});

export const getLearned = Effect.fn("learn.getLearned")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = learnedDir(ws, id);

  if (!isSimpleId(id) || !(yield* ws.exists(`${dir}/${LEARNED_FILE}`))) {
    return yield* new NotFound({ message: `Nothing learned as ${id}` });
  }

  const doc = yield* ws.readYaml(`${dir}/${LEARNED_FILE}`, LearnedDoc);
  const unread = yield* unreadIds;

  const learned: Learned = {
    id,
    dir,
    doc,
    unread: unread.has(id),
    preprocess: yield* readPreprocess(dir),
  };

  return learned;
});

/** Remove a learned entry's folder and its section of about.md. */
export const forget = Effect.fn("learn.forget")(function* (id: string) {
  const ws = yield* Workspace;
  const learned = yield* getLearned(id);

  yield* ws.exclusive(
    ABOUT_FILE,
    Effect.gen(function* () {
      const about = yield* readOptionalText(ABOUT_FILE);

      if (about === undefined) return;
      const kept = withoutSection(about, id);

      if (kept !== about) yield* ws.writeText(ABOUT_FILE, kept);
    }),
  );

  yield* ws.remove(learned.dir);
});

/** What an agent should do about sources nobody has read yet; `about` is about.md's absolute path. */
export function learnNotices(learned: ReadonlyArray<Learned>, about: string): string[] {
  const unread = learned.flatMap((entry) => (entry.unread ? [entry.id] : []));

  if (unread.length === 0) return [];

  return [
    `${about} has sections no agent has read yet (${unread.join(", ")}). Before work that depends on ` +
      "the product, audience, or voice, read each source and its learned folder, rewrite its section " +
      `with what matters for the videos, and delete the "${UNREAD}" line. Keep the <!-- learned:id --> line.`,
  ];
}

/** about.md with its absolute path, for agents; undefined until something is learned or written. */
export const readAbout = Effect.fn("learn.readAbout")(function* () {
  const ws = yield* Workspace;
  const text = yield* readOptionalText(ABOUT_FILE);

  return text === undefined ? undefined : { path: yield* ws.abs(ABOUT_FILE), text };
});

// ---------------------------------------------------------------------------------------------
// Links

const learnLink = Effect.fn("learn.learnLink")(function* (given: string) {
  const url = yield* cleanUrl(given);
  const warnings: Array<string> = [];
  const store = detectSource(url) !== "web";
  const video = !store && isVideoLink(url);

  // A video's page is a bonus; without it yt-dlp still finds the title.
  const listing = video
    ? yield* fetchListing(url).pipe(
        Effect.catch((error) =>
          Effect.sync(() => {
            warnings.push(`Could not read the page: ${error.message}`);

            return undefined;
          }),
        ),
      )
    : yield* fetchListing(url);

  const title = listing?.title ?? listing?.name ?? new URL(url).hostname;

  const learned = yield* save(title, (dir) =>
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
  const downloaded = yield* downloadVideo(url, dir).pipe(
    Effect.catch((error) =>
      listing === undefined
        ? Effect.fail(error)
        : Effect.sync(() => {
            warnings.push(`Saved as a page without the video: ${error.message}`);

            return undefined;
          }),
    ),
  );

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
    download(url, `${dir}/${stem}`).pipe(
      Effect.map((file) => file.slice(dir.length + 1)),
      Effect.catch((error) =>
        Effect.sync(() => {
          warnings.push(`Could not download ${url}: ${error.message}`);

          return undefined;
        }),
      ),
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
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const info = yield* probe(yield* ws.abs(`${dir}/${video}`));
    const preprocess = yield* preprocessVideo(dir, video, info);
    const { duration, width, height, fps, hasAudio } = info;

    return { probe: { duration, width, height, fps, hasAudio }, preprocess };
  }).pipe(
    Effect.catch((error) =>
      Effect.sync(() => {
        warnings.push(`Could not preprocess ${video}: ${error.message}`);

        return { probe: undefined, preprocess: undefined };
      }),
    ),
  );

// ---------------------------------------------------------------------------------------------
// Files and folders

const learnPath = Effect.fn("learn.learnPath")(function* (given: string) {
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

  const learned = yield* save(name, () =>
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
const learnFile = Effect.fn("learn.learnFile")(function* (
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

  const learned = yield* save(title, (dir) =>
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

/** The first heading and first real paragraph of a README or note, as plain text. */
export function summarize(markdown: string): { title?: string; description: string } {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/<!--[\s\S]*?-->/g, "");
  const heading = /^#\s+(.+?)\s*#*\s*$/m.exec(body)?.[1];
  const title = heading === undefined ? undefined : plain(heading);

  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block !== "" &&
        !/^(#|<|!\[|\[!\[|```|~~~|\||---|===|\* \* \*)/.test(block) &&
        !/\n(=+|-+)\s*$/.test(block) &&
        plain(block) !== "",
    );

  const description =
    paragraph === undefined ? "" : clip(plain(paragraph.replace(/^>\s?/gm, "")), SUMMARY_TEXT);

  return title === undefined || title === "" ? { description } : { title, description };
}

/** Markdown inline syntax and HTML tags dropped, whitespace collapsed. */
const plain = (markdown: string) =>
  markdown
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;

// ---------------------------------------------------------------------------------------------
// Saving and about.md

/** Claim learned/<id> for `title`, then fill it; the folder goes away if anything fails before it is in about.md. */
const save = <E, R>(title: string, fill: (dir: string) => Effect.Effect<Found, E, R>) =>
  Effect.gen(function* () {
    const ws = yield* Workspace;

    const id = yield* ws.exclusive(
      LEARNED_FILE,
      Effect.gen(function* () {
        const base = slugify(shortName(title));
        let candidate = base;

        for (let n = 2; yield* ws.exists(learnedDir(ws, candidate)); n++)
          candidate = `${base}-${n}`;
        yield* ws.mkdir(learnedDir(ws, candidate));

        return candidate;
      }),
    );

    const dir = learnedDir(ws, id);

    return yield* Effect.gen(function* () {
      const found = yield* fill(dir);

      const doc: LearnedDoc = {
        ...found.doc,
        title: oneLine(found.doc.title),
        addedAt: yield* nowIso,
      };

      yield* ws.writeYaml(`${dir}/${LEARNED_FILE}`, LearnedDoc, doc);
      yield* addSection(id, dir, doc);
      const learned: Learned = { id, dir, doc, unread: true, preprocess: found.preprocess };

      return learned;
    }).pipe(Effect.onError(() => Effect.ignore(ws.remove(dir))));
  });

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim() || "Untitled";

/** The section of about.md a new entry starts with, for an agent to rewrite once it has read the source. */
export function aboutSection(id: string, dir: string, doc: LearnedDoc): string {
  const where =
    doc.source === undefined
      ? "- Uploaded file"
      : "url" in doc.source
        ? `- Link: ${doc.source.url}`
        : `- ${doc.kind === "folder" ? "Folder" : "File"}: ${doc.source.path}`;

  // A line starting with # in the text would read as a heading and split the section.
  const text = clip(doc.description.trim(), SECTION_TEXT).replace(/^#/gm, "\\#");

  return [
    `## ${doc.title}`,
    marker(id),
    UNREAD_LINE,
    "",
    where,
    ...(doc.site === undefined ? [] : [`- By: ${doc.site}`]),
    ...(doc.links.length === 0 ? [] : [`- Also: ${doc.links.join(", ")}`]),
    `- Saved: ${dir}/`,
    ...(text === "" ? [] : ["", text]),
  ].join("\n");
}

const addSection = Effect.fnUntraced(function* (id: string, dir: string, doc: LearnedDoc) {
  const ws = yield* Workspace;

  yield* ws.exclusive(
    ABOUT_FILE,
    Effect.gen(function* () {
      const about = (yield* readOptionalText(ABOUT_FILE)) ?? ABOUT_HEADER;
      yield* ws.writeText(ABOUT_FILE, `${about.trimEnd()}\n\n${aboutSection(id, dir, doc)}\n`);
    }),
  );
});

export interface AboutSection {
  /** The learned entry it was written for, from its marker line; none for a section a person added. */
  readonly id?: string | undefined;
  /** Line indexes: from the heading up to, not including, `end`. */
  readonly start: number;
  readonly end: number;
  readonly unread: boolean;
}

/** about.md's `#` and `##` sections; deeper headings belong to the section they are in. */
export function aboutSections(about: string): ReadonlyArray<AboutSection> {
  const lines = about.split("\n");
  const starts = lines.flatMap((line, index) => (/^#{1,2} /.test(line) ? [index] : []));

  return starts.map((start, n) => {
    const end = starts[n + 1] ?? lines.length;
    const body = lines.slice(start + 1, end);

    const id = body
      .map((line) => MARKER.exec(line.trim())?.[1])
      .find((found) => found !== undefined);

    return { id, start, end, unread: body.some((line) => line.startsWith(UNREAD)) };
  });
}

function withoutSection(about: string, id: string): string {
  const section = aboutSections(about).find((found) => found.id === id);

  if (section === undefined) return about;
  const lines = about.split("\n");

  return `${[...lines.slice(0, section.start), ...lines.slice(section.end)].join("\n").trimEnd()}\n`;
}

const unreadIds = Effect.map(
  readOptionalText(ABOUT_FILE),
  (about) =>
    new Set(
      aboutSections(about ?? "").flatMap((section) =>
        section.unread && section.id !== undefined ? [section.id] : [],
      ),
    ),
);
