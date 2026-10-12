import { Effect, Match, Option, Schema } from "effect";

import { CommandFailed, InvalidRequest, NotFound } from "./errors.ts";
import { isSimpleId, readOptionalText } from "./library.ts";
import { extension, mediaKind, probe } from "./media.ts";
import { run, tail, which } from "./process.ts";
import { PreprocessResult, ReferenceDoc } from "./schema.ts";
import { Workspace, type WorkspaceService, nowIso, slugify } from "./workspace.ts";

export const REFERENCE_FILE = "reference.yaml";

export const ANALYSIS_FILE = "analysis.md";

export const PREPROCESS_FILE = "preprocess.json";

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

const PreprocessJson = Schema.fromJsonString(PreprocessResult, { space: 2 });

const decodePreprocess = Schema.decodeUnknownOption(PreprocessJson);

const encodePreprocess = Schema.encodeEffect(PreprocessJson);

const refDir = (ws: WorkspaceService, id: string) => `${ws.config.paths.references}/${id}`;

export const getReference = Effect.fn("references.getReference")(function* (id: string) {
  const ws = yield* Workspace;
  const dir = refDir(ws, id);

  if (!isSimpleId(id) || !(yield* ws.exists(`${dir}/${REFERENCE_FILE}`))) {
    return yield* new NotFound({ message: `Reference not found: ${id}` });
  }

  const doc = yield* ws.readYaml(`${dir}/${REFERENCE_FILE}`, ReferenceDoc);
  const analysis = yield* readOptionalText(`${dir}/${ANALYSIS_FILE}`);
  const preprocessText = yield* readOptionalText(`${dir}/${PREPROCESS_FILE}`);

  // preprocess.json is derived data; a damaged copy reads as "not preprocessed" so it can be redone.
  const preprocess =
    preprocessText === undefined
      ? undefined
      : Option.getOrUndefined(decodePreprocess(preprocessText));

  const reference: Reference = { id, dir, doc, analysis, preprocess };

  return reference;
});

export const listReferences = Effect.fn("references.listReferences")(function* () {
  const ws = yield* Workspace;
  const entries = yield* ws.list(ws.config.paths.references);

  const ids = yield* Effect.filter(
    entries.flatMap((entry) => (entry.dir ? [entry.name] : [])),
    (id) => ws.exists(`${refDir(ws, id)}/${REFERENCE_FILE}`),
    { concurrency: 8 },
  );

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

interface Fetched {
  readonly video: string;
  readonly title?: string | undefined;
}

/** Download with yt-dlp into `dir` as source.<ext>; resolves to the file name and the page's title. */
const downloadVideo = Effect.fn("references.downloadVideo")(function* (url: string, dir: string) {
  const ws = yield* Workspace;
  const ytDlp = yield* which("yt-dlp");

  if (Option.isNone(ytDlp)) {
    return yield* new CommandFailed({
      message: "yt-dlp is required to add references by URL (brew install yt-dlp).",
    });
  }

  const result = yield* run(
    ytDlp.value,
    [
      "--no-playlist",
      "-f",
      "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b",
      "--merge-output-format",
      "mp4",
      "-o",
      "source.%(ext)s",
      "--print",
      "after_move:title",
      url,
    ],
    { cwd: yield* ws.abs(dir) },
  );

  if (result.code !== 0)
    return yield* new CommandFailed({ message: `yt-dlp failed: ${tail(result.stderr, 2)}` });
  // The fallback formats are not always mp4, so look for whatever yt-dlp wrote.
  const entries = yield* ws.list(dir);

  const video = entries.find(
    (entry) => entry.name.startsWith("source.") && mediaKind(entry.name) === "video",
  );

  if (video === undefined)
    return yield* new CommandFailed({ message: `yt-dlp saved no video for ${url}` });
  const title = result.stdout.trim().split("\n").pop()?.trim();
  const fetched: Fetched = { video: video.name, title: title === "" ? undefined : title };

  return fetched;
});

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
  const fetched: Fetched = { video };

  return fetched;
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

/** Parse `pts_time:` values printed by ffmpeg's showinfo filter. */
export function parseShowinfoTimes(stderr: string): number[] {
  return Array.from(
    stderr.matchAll(/pts_time:([\d.]+)/g),
    (match) => Math.round(Number(match[1]) * 100) / 100,
  );
}

/** Hook frames every 0.5s for the first 3s, then one frame per second; none at or past the end. */
export function frameTimes(duration: number): number[] {
  const times = new Set<number>();

  for (let t = 0; t <= 3 && t < duration; t += 0.5) times.add(t);

  for (let t = 4; t < duration; t += 1) times.add(t);

  return [...times].toSorted((a, b) => a - b);
}

const frameFile = (t: number) => `frames/t${t.toFixed(1).padStart(5, "0")}.jpg`;

const CONTACT_COLUMNS = 6;

/** Transcribe with a local Whisper when one is installed; resolves to the reference-relative .srt. */
const transcribe = Effect.fn("references.transcribe")(function* (wav: string, absDir: string) {
  const whisper = yield* which("whisper");

  if (Option.isNone(whisper)) return undefined;
  const result = yield* run(whisper.value, [wav, "--output_format", "srt", "--output_dir", absDir]);

  return result.code === 0 ? "audio.srt" : undefined;
});

/**
 * Deterministic, key-free preprocessing an agent can build on: scene cuts, sampled frames, a
 * contact sheet, and (when a local Whisper is installed) a transcript.
 */
export const preprocessReference = Effect.fn("references.preprocessReference")(function* (
  id: string,
) {
  const ws = yield* Workspace;
  const reference = yield* getReference(id);

  if (reference.doc.video === undefined) {
    return yield* new InvalidRequest({ message: `Reference ${id} has no video` });
  }

  const dir = yield* ws.abs(reference.dir);
  const input = `${dir}/${reference.doc.video}`;
  const duration = reference.doc.probe?.duration ?? (yield* probe(input)).duration;
  const notes: Array<string> = [];

  const cutRun = yield* run("ffmpeg", [
    "-hide_banner",
    "-i",
    input,
    "-vf",
    "select='gt(scene,0.3)',showinfo",
    "-f",
    "null",
    "-",
  ]);

  if (cutRun.code !== 0) notes.push(`Scene detection failed: ${tail(cutRun.stderr, 2)}`);
  const cuts = cutRun.code === 0 ? parseShowinfoTimes(cutRun.stderr) : [];

  yield* ws.mkdir(`${reference.dir}/frames`);

  const frames = yield* Effect.forEach(
    frameTimes(duration),
    (t) =>
      run("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-ss",
        String(t),
        "-i",
        input,
        "-frames:v",
        "1",
        "-vf",
        "scale=360:-2",
        "-q:v",
        "4",
        `${dir}/${frameFile(t)}`,
      ]).pipe(Effect.map((result) => (result.code === 0 ? [{ file: frameFile(t), t }] : []))),
    { concurrency: 4 },
  );

  const rows = Math.max(1, Math.ceil(Math.min(duration, 60) / CONTACT_COLUMNS));

  const sheet = yield* run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vf",
    `fps=1,scale=240:-2,tile=${CONTACT_COLUMNS}x${rows}:padding=4:margin=4`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    `${dir}/contact.jpg`,
  ]);

  if (sheet.code !== 0) notes.push(`Contact sheet failed: ${tail(sheet.stderr, 2)}`);

  const audioRun =
    reference.doc.probe?.hasAudio === false
      ? undefined
      : yield* run("ffmpeg", [
          "-y",
          "-v",
          "error",
          "-i",
          input,
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          `${dir}/audio.wav`,
        ]);

  const audio = audioRun?.code === 0 ? "audio.wav" : undefined;
  const transcript = audio === undefined ? undefined : yield* transcribe(`${dir}/${audio}`, dir);

  if (audio !== undefined && transcript === undefined) {
    notes.push(
      "No local Whisper found (the `whisper` CLI); transcript skipped. The agent can transcribe audio.wav itself.",
    );
  }

  const result: PreprocessResult = {
    cuts,
    frames: frames.flat(),
    contactSheet: sheet.code === 0 ? "contact.jpg" : undefined,
    audio,
    transcript,
    notes,
  };

  const json = yield* encodePreprocess(result).pipe(
    Effect.mapError(
      (error) =>
        new CommandFailed({ message: `Could not encode ${PREPROCESS_FILE}: ${error.message}` }),
    ),
  );

  yield* ws.writeText(`${reference.dir}/${PREPROCESS_FILE}`, `${json}\n`);
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
