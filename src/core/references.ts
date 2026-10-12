import { copyFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { mediaKind, probe } from "./media.ts";
import { ReferenceDoc } from "./schema.ts";
import { type Workspace, nowIso, slugify } from "./workspace.ts";

export const REFERENCE_FILE = "reference.yaml";
export const ANALYSIS_FILE = "analysis.md";
export const PREPROCESS_FILE = "preprocess.json";

export interface Reference {
  id: string;
  dir: string;
  doc: ReferenceDoc;
  analysis?: string;
  preprocess?: PreprocessResult;
}

export interface PreprocessResult {
  cuts: number[];
  frames: { file: string; t: number }[];
  contactSheet?: string;
  audio?: string;
  transcript?: string;
  notes: string[];
}

const refDir = (ws: Workspace, id: string) => `${ws.config.paths.references}/${id}`;

export async function listReferences(ws: Workspace): Promise<Reference[]> {
  const entries = await ws.list(ws.config.paths.references);
  const ids = entries
    .filter((e) => e.dir && ws.exists(`${refDir(ws, e.name)}/${REFERENCE_FILE}`))
    .map((e) => e.name);
  return Promise.all(ids.map((id) => getReference(ws, id)));
}

export async function getReference(ws: Workspace, id: string): Promise<Reference> {
  const dir = refDir(ws, id);
  const doc = await ws.readYaml(`${dir}/${REFERENCE_FILE}`, ReferenceDoc);
  const ref: Reference = { id, dir, doc };
  if (ws.exists(`${dir}/${ANALYSIS_FILE}`))
    ref.analysis = await ws.readText(`${dir}/${ANALYSIS_FILE}`);
  if (ws.exists(`${dir}/${PREPROCESS_FILE}`))
    ref.preprocess = JSON.parse(await ws.readText(`${dir}/${PREPROCESS_FILE}`));
  return ref;
}

function uniqueId(ws: Workspace, base: string): string {
  let id = base;
  for (let n = 2; ws.exists(refDir(ws, id)); n++) id = `${base}-${n}`;
  return id;
}

export type ReferenceSource =
  | { kind: "file"; path: string }
  | { kind: "bytes"; name: string; bytes: ArrayBuffer }
  | { kind: "url"; url: string };

/** Store a reference video in the workspace, then run deterministic preprocessing. */
export async function addReference(
  ws: Workspace,
  source: ReferenceSource,
  opts: { title?: string; tags?: string[]; preprocess?: boolean } = {},
): Promise<Reference> {
  const provisional =
    opts.title ??
    (source.kind === "url"
      ? source.url
      : source.kind === "file"
        ? basename(source.path)
        : source.name);
  const id = uniqueId(
    ws,
    `${new Date().toISOString().slice(0, 10)}-${slugify(stripExt(provisional))}`,
  );
  const dir = refDir(ws, id);
  await ws.mkdir(dir);

  let video: string;
  let title = opts.title;
  if (source.kind === "url") {
    const downloaded = await download(source.url, ws.abs(dir));
    video = downloaded.file;
    title ??= downloaded.title;
  } else if (source.kind === "file") {
    video = `source${extname(source.path).toLowerCase()}`;
    await copyFile(source.path, ws.abs(`${dir}/${video}`));
  } else {
    video = `source${extname(source.name).toLowerCase()}`;
    await Bun.write(ws.abs(`${dir}/${video}`), source.bytes);
  }
  if (mediaKind(video) !== "video") throw new Error(`Not a video file: ${video}`);

  const doc = ReferenceDoc.parse({
    title: title ?? stripExt(provisional),
    source:
      source.kind === "url"
        ? source.url
        : source.kind === "file"
          ? basename(source.path)
          : source.name,
    video,
    addedAt: nowIso(),
    tags: opts.tags ?? [],
    probe: await probe(ws.abs(`${dir}/${video}`)),
  });
  await ws.writeYaml(`${dir}/${REFERENCE_FILE}`, doc);
  if (opts.preprocess !== false) await preprocessReference(ws, id);
  return getReference(ws, id);
}

const stripExt = (name: string) => name.replace(/\.[a-z0-9]{2,4}$/i, "");

async function run(
  cmd: string[],
  cwd?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", ...(cwd ? { cwd } : {}) });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

async function download(url: string, absDir: string): Promise<{ file: string; title?: string }> {
  if (!Bun.which("yt-dlp"))
    throw new Error("yt-dlp is required to add references by URL (brew install yt-dlp).");
  const res = await run(
    [
      "yt-dlp",
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
    absDir,
  );
  if (res.code !== 0) throw new Error(`yt-dlp failed: ${res.stderr.trim().split("\n").pop()}`);
  const title = res.stdout.trim().split("\n").pop();
  return title ? { file: "source.mp4", title } : { file: "source.mp4" };
}

/** Parse `pts_time:` values printed by ffmpeg's showinfo filter. */
export function parseShowinfoTimes(stderr: string): number[] {
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map(
    (m) => Math.round(Number(m[1]) * 100) / 100,
  );
}

/** Hook frames every 0.5s for the first 3s, then one frame per second. */
export function frameTimes(duration: number): number[] {
  const times = new Set<number>();
  for (let t = 0; t <= Math.min(3, duration); t += 0.5) times.add(t);
  for (let t = 4; t < duration; t += 1) times.add(t);
  return [...times].sort((a, b) => a - b);
}

/**
 * Deterministic, key-free preprocessing an agent can build on: scene cuts, sampled
 * frames, a contact sheet, and (when a local Whisper is installed) a transcript.
 */
export async function preprocessReference(ws: Workspace, id: string): Promise<PreprocessResult> {
  const ref = await getReference(ws, id);
  if (!ref.doc.video) throw new Error(`Reference ${id} has no video`);
  const dir = ws.abs(ref.dir);
  const input = `${dir}/${ref.doc.video}`;
  const duration = ref.doc.probe?.duration ?? (await probe(input)).duration;
  const notes: string[] = [];

  const cutRun = await run([
    "ffmpeg",
    "-hide_banner",
    "-i",
    input,
    "-vf",
    "select='gt(scene,0.3)',showinfo",
    "-f",
    "null",
    "-",
  ]);
  const cuts = parseShowinfoTimes(cutRun.stderr);

  await ws.mkdir(`${ref.dir}/frames`);
  const frames: { file: string; t: number }[] = [];
  for (const t of frameTimes(duration)) {
    const file = `frames/t${t.toFixed(1).padStart(5, "0")}.jpg`;
    const res = await run([
      "ffmpeg",
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
      `${dir}/${file}`,
    ]);
    if (res.code === 0) frames.push({ file, t });
  }

  const result: PreprocessResult = { cuts, frames, notes };
  const cols = 6;
  const rows = Math.max(1, Math.ceil(Math.min(duration, 60) / cols));
  const sheet = await run([
    "ffmpeg",
    "-y",
    "-v",
    "error",
    "-i",
    input,
    "-vf",
    `fps=1,scale=240:-2,tile=${cols}x${rows}:padding=4:margin=4`,
    "-frames:v",
    "1",
    "-q:v",
    "4",
    `${dir}/contact.jpg`,
  ]);
  if (sheet.code === 0) result.contactSheet = "contact.jpg";

  if (ref.doc.probe?.hasAudio !== false) {
    const audio = await run([
      "ffmpeg",
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
    if (audio.code === 0) {
      result.audio = "audio.wav";
      const transcript = await transcribe(`${dir}/audio.wav`, dir);
      if (transcript) result.transcript = transcript;
      else
        notes.push(
          "No local Whisper found (the `whisper` CLI); transcript skipped. The agent can transcribe audio.wav itself.",
        );
    }
  }

  await ws.writeText(`${ref.dir}/${PREPROCESS_FILE}`, JSON.stringify(result, null, 2));
  const doc = { ...ref.doc, preprocessed: true };
  await ws.writeYaml(`${ref.dir}/${REFERENCE_FILE}`, doc);
  return result;
}

async function transcribe(wav: string, absDir: string): Promise<string | undefined> {
  if (Bun.which("whisper")) {
    const res = await run(["whisper", wav, "--output_format", "srt", "--output_dir", absDir]);
    if (res.code === 0) return "audio.srt";
  }
  return undefined;
}

export async function saveAnalysis(
  ws: Workspace,
  id: string,
  markdown: string,
): Promise<Reference> {
  const ref = await getReference(ws, id);
  await ws.writeText(`${ref.dir}/${ANALYSIS_FILE}`, markdown);
  return getReference(ws, id);
}
