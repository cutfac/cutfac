import { Effect, Match } from "effect";

import { InvalidRequest, NotFound } from "./errors.ts";
import { isSimpleId, readOptionalText } from "./library.ts";
import { extension, mediaKind, probe } from "./media.ts";
import { type Downloaded, downloadVideo, preprocessVideo, readPreprocess } from "./preprocess.ts";
import { type PreprocessResult, ReferenceDoc } from "./schema.ts";
import { Workspace, type WorkspaceService, foldersWith, nowIso, slugify } from "./workspace.ts";

export const REFERENCE_FILE = "reference.yaml";

export const ANALYSIS_FILE = "analysis.md";

export interface Reference {
  readonly id: string;
  /** Workspace-relative folder holding the video, frames, and analysis. */
  readonly dir: string;
  readonly doc: ReferenceDoc;
  readonly analysis?: string | undefined;
  readonly preprocess?: PreprocessResult | undefined;
}

/** A video already on disk (`name` is what the user called it, e.g. an upload), or a page yt-dlp can read. */
export type ReferenceSource =
  | { readonly kind: "file"; readonly path: string; readonly name?: string | undefined }
  | { readonly kind: "url"; readonly url: string };

const URL_SOURCE = /^https?:\/\//;

/** Read a CLI or agent argument as a reference source: http(s) URLs go to yt-dlp, anything else is a file. */
export const referenceSourceOf = (source: string): ReferenceSource =>
  URL_SOURCE.test(source) ? { kind: "url", url: source } : { kind: "file", path: source };

export interface AddReferenceOptions {
  readonly title?: string | undefined;
  readonly tags?: ReadonlyArray<string> | undefined;
  /** Run preprocessing right away; defaults to true. */
  readonly preprocess?: boolean | undefined;
}

export const refDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.references}/${id}`;

export const getReference = Effect.fn("references.getReference")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = refDir(ws, id);

  if (!isSimpleId(id) || !(yield* ws.exists(`${dir}/${REFERENCE_FILE}`))) {
    return yield* new NotFound({ message: `Reference not found: ${id}` });
  }

  const doc = yield* ws.readYaml(`${dir}/${REFERENCE_FILE}`, ReferenceDoc);
  const analysis = yield* readOptionalText(`${dir}/${ANALYSIS_FILE}`);
  const preprocess = yield* readPreprocess(dir);

  const reference: Reference = { id, dir, doc, analysis, preprocess };

  return reference;
});

export const listReferences = Effect.fn("references.listReferences")(function* () {
  const ws = yield* Workspace;
  const ids = yield* foldersWith(ws.config.paths.references, REFERENCE_FILE);

  return yield* Effect.forEach(ids, getReference, { concurrency: 8 });
});

const uniqueId = Effect.fn("references.uniqueId")(function* (base: string) {
  const ws = yield* Workspace;
  let id = base;

  for (let n = 2; yield* ws.exists(refDir(ws, id)); n++) id = `${base}-${n}`;

  return id;
});

const stripExtension = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "");

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

const sourceLabel = Match.type<ReferenceSource>().pipe(
  Match.discriminatorsExhaustive("kind")({
    file: (source) => source.name ?? baseName(source.path),
    url: (source) => source.url,
  }),
);

const importVideo = Effect.fn("references.importVideo")(function* (
  source: ReferenceSource,
  dir: string,
) {
  const ws = yield* Workspace;

  if (source.kind === "url") return yield* downloadVideo(source.url, dir);
  const name = sourceLabel(source);

  if (mediaKind(name) !== "video")
    return yield* new InvalidRequest({ message: `Not a video file: ${name}` });
  const video = `source.${extension(name)}`;
  yield* ws.importFile(source.path, `${dir}/${video}`);
  const imported: Downloaded = { video };

  return imported;
});

/** Store a reference video in the workspace, then run deterministic preprocessing. */
export const addReference = Effect.fn("references.addReference")(function* (
  source: ReferenceSource,
  options: AddReferenceOptions = {},
) {
  const ws = yield* Workspace;
  const label = sourceLabel(source);
  const provisional = options.title ?? label;
  const today = (yield* nowIso).slice(0, 10);
  const id = yield* uniqueId(`${today}-${slugify(stripExtension(provisional)) || "reference"}`);
  const dir = refDir(ws, id);
  yield* ws.mkdir(dir);

  // Until reference.yaml exists the folder is only a half-imported video; don't leave it behind.
  yield* Effect.gen(function* () {
    const { video, title } = yield* importVideo(source, dir);
    const info = yield* probe(yield* ws.abs(`${dir}/${video}`));

    const doc: ReferenceDoc = {
      title: options.title ?? title ?? stripExtension(provisional),
      source: label,
      video,
      addedAt: yield* nowIso,
      tags: options.tags ?? [],
      probe: {
        duration: info.duration,
        width: info.width,
        height: info.height,
        fps: info.fps,
        hasAudio: info.hasAudio,
      },
      preprocessed: false,
    };

    yield* ws.writeYaml(`${dir}/${REFERENCE_FILE}`, ReferenceDoc, doc);
  }).pipe(Effect.onError(() => Effect.ignore(ws.remove(dir))));

  if (options.preprocess !== false) yield* preprocessReference(id);

  return yield* getReference(id);
});

/** Run deterministic preprocessing on a reference's video and mark it preprocessed. */
export const preprocessReference = Effect.fn("references.preprocessReference")(function* (
  id: string,
) {
  const ws = yield* Workspace;
  const reference = yield* getReference(id);

  if (reference.doc.video === undefined) {
    return yield* new InvalidRequest({ message: `Reference ${id} has no video` });
  }

  const result = yield* preprocessVideo(reference.dir, reference.doc.video, reference.doc.probe);
  yield* ws.writeYaml(`${reference.dir}/${REFERENCE_FILE}`, ReferenceDoc, {
    ...reference.doc,
    preprocessed: true,
  });

  return result;
});

export const saveAnalysis = Effect.fn("references.saveAnalysis")(function* (
  id: string,
  markdown: string,
) {
  const ws = yield* Workspace;
  const reference = yield* getReference(id);
  yield* ws.writeText(`${reference.dir}/${ANALYSIS_FILE}`, markdown);

  return yield* getReference(id);
});
