import { Effect, Option, Schema } from "effect";

import { CommandFailed } from "./errors.ts";
import { readOptionalText } from "./library.ts";
import { mediaKind, probe, sceneCuts } from "./media.ts";
import { run, tail, which } from "./process.ts";
import { PreprocessResult } from "./schema.ts";
import { Workspace } from "./workspace.ts";

export const PREPROCESS_FILE = "preprocess.json";

const PreprocessJson = Schema.fromJsonString(PreprocessResult, { space: 2 });

const decodePreprocess = Schema.decodeUnknownOption(PreprocessJson);

const encodePreprocess = Schema.encodeEffect(PreprocessJson);

/**
 * The preprocess.json in workspace folder `dir`. It is derived data, so a damaged copy reads as
 * "not preprocessed" and can be redone.
 */
export const readPreprocess = Effect.fn("preprocess.readPreprocess")(function* (dir: string) {
  const text = yield* readOptionalText(`${dir}/${PREPROCESS_FILE}`);

  return text === undefined ? undefined : Option.getOrUndefined(decodePreprocess(text));
});

export interface Downloaded {
  /** The file name inside the folder. */
  readonly video: string;
  readonly title?: string | undefined;
}

/** Download with yt-dlp into workspace folder `dir` as source.<ext>, with the page's title. */
export const downloadVideo = Effect.fn("preprocess.downloadVideo")(function* (
  url: string,
  dir: string,
) {
  const ws = yield* Workspace;
  const ytDlp = yield* which("yt-dlp");

  if (Option.isNone(ytDlp)) {
    return yield* new CommandFailed({
      message: "yt-dlp is required to download videos from links (brew install yt-dlp).",
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
  const downloaded: Downloaded = { video: video.name, title: title === "" ? undefined : title };

  return downloaded;
});

/** Hook frames every 0.5s for the first 3s, then one frame per second; none at or past the end. */
export function frameTimes(duration: number): number[] {
  const times = new Set<number>();

  for (let t = 0; t <= 3 && t < duration; t += 0.5) times.add(t);

  for (let t = 4; t < duration; t += 1) times.add(t);

  return [...times].toSorted((a, b) => a - b);
}

const frameFile = (t: number) => `frames/t${t.toFixed(1).padStart(5, "0")}.jpg`;

const CONTACT_COLUMNS = 6;

/** Transcribe with a local Whisper when one is installed; resolves to the folder-relative .srt. */
const transcribe = Effect.fn("preprocess.transcribe")(function* (wav: string, absDir: string) {
  const whisper = yield* which("whisper");

  if (Option.isNone(whisper)) return undefined;
  const result = yield* run(whisper.value, [wav, "--output_format", "srt", "--output_dir", absDir]);

  return result.code === 0 ? "audio.srt" : undefined;
});

export interface KnownProbe {
  readonly duration: number;
  readonly hasAudio: boolean;
}

/**
 * Deterministic, key-free preprocessing an agent can build on, written next to `video` in
 * workspace folder `dir`: scene cuts, sampled frames, a contact sheet, and (when a local Whisper is
 * installed) a transcript. The result is also saved as preprocess.json.
 */
export const preprocessVideo = Effect.fn("preprocess.preprocessVideo")(function* (
  dir: string,
  video: string,
  known?: KnownProbe,
) {
  const ws = yield* Workspace;
  const absDir = yield* ws.abs(dir);
  const input = `${absDir}/${video}`;
  const info = known ?? (yield* probe(input));
  const notes: Array<string> = [];

  const cuts = yield* sceneCuts(input).pipe(
    Effect.catchTag("CommandFailed", (error) =>
      Effect.sync((): number[] => {
        notes.push(error.message);

        return [];
      }),
    ),
  );

  yield* ws.mkdir(`${dir}/frames`);

  const frames = yield* Effect.forEach(
    frameTimes(info.duration),
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
        `${absDir}/${frameFile(t)}`,
      ]).pipe(Effect.map((result) => (result.code === 0 ? [{ file: frameFile(t), t }] : []))),
    { concurrency: 4 },
  );

  const rows = Math.max(1, Math.ceil(Math.min(info.duration, 60) / CONTACT_COLUMNS));

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
    `${absDir}/contact.jpg`,
  ]);

  if (sheet.code !== 0) notes.push(`Contact sheet failed: ${tail(sheet.stderr, 2)}`);

  const audioRun = info.hasAudio
    ? yield* run("ffmpeg", [
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
        `${absDir}/audio.wav`,
      ])
    : undefined;

  const audio = audioRun?.code === 0 ? "audio.wav" : undefined;

  const transcript =
    audio === undefined ? undefined : yield* transcribe(`${absDir}/${audio}`, absDir);

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

  yield* ws.writeText(`${dir}/${PREPROCESS_FILE}`, `${json}\n`);

  return result;
});
