// Renders index.html beside this file to an MP4: each frame is the page's seek(t), captured in
// headless Chromium, and the sound is the page's soundtrack(). Needs Playwright with its Chromium
// (`npm install` here, then `npx playwright install chromium`) and ffmpeg.
//
//   node render.mjs [out.mp4]     defaults to `[9x16] <name>.mp4` in the folder above

import { spawn } from "node:child_process";
import { createReadStream, existsSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const here = dirname(fileURLToPath(import.meta.url));
const WORKERS = 4;
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".ttf": "font/ttf", ".otf": "font/otf" };

// Served over HTTP, as fonts and copy.json can't load from a file:// page.
const server = createServer((request, response) => {
  const path = normalize(join(here, decodeURIComponent(new URL(request.url, "http://x").pathname)));
  const file = path.endsWith("/") ? join(path, "index.html") : path;
  if (!file.startsWith(here) || !existsSync(file)) return response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(response);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();

async function open() {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
  page.on("pageerror", (error) => console.error(error));
  await page.goto(url);
  await page.waitForFunction(() => window.ready === true, null, { timeout: 60_000 });
  const video = await page.evaluate(() => window.VIDEO);
  await page.setViewportSize({ width: video.width, height: video.height });
  return { page, video };
}

const first = await open();
const { video } = first;
const out = process.argv[2] ?? join(here, "..", `[9x16] ${video.name}.mp4`);
// Written beside the video and moved over it once whole, so the last render stays playable meanwhile.
const partial = join(dirname(out), `.${process.pid}.rendering.mp4`);
const total = Math.round(video.seconds * video.fps);
const pages = [first.page, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, open))).map((p) => p.page)];

const sound = await first.page.evaluate(() => window.soundtrack());
const wav = join(tmpdir(), `cutfac-sound-${process.pid}.wav`);
writeFileSync(wav, wavFile(Buffer.from(sound.pcm, "base64"), sound.rate, sound.channels));

const ffmpeg = spawn(
  "ffmpeg",
  ["-y", "-v", "error", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(video.fps), "-i", "-",
    "-i", wav, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "medium",
    "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart", partial],
  { stdio: ["pipe", "inherit", "inherit"] },
);

const capture = async (page, frame) => {
  await page.evaluate((t) => window.seek(t), frame / video.fps);
  return page.screenshot({ type: "jpeg", quality: 95 });
};

// Each page takes every WORKERS-th frame; frames go to ffmpeg in order as they come in.
const done = new Map();
let next = 0;
const flush = () => {
  while (done.has(next)) {
    ffmpeg.stdin.write(done.get(next));
    done.delete(next);
    // Worded as Cutfac's render progress reads it.
    if (next % video.fps === 0) process.stderr.write(`Rendered ${next}/${total}\n`);
    next++;
  }
};
await Promise.all(
  pages.map(async (page, worker) => {
    for (let frame = worker; frame < total; frame += WORKERS) {
      done.set(frame, await capture(page, frame));
      flush();
    }
  }),
);
ffmpeg.stdin.end();
const code = await new Promise((resolve) => ffmpeg.on("close", resolve));
await browser.close();
server.close();
if (code !== 0) {
  rmSync(partial, { force: true });
  throw new Error(`ffmpeg failed (${code})`);
}
renameSync(partial, out);
process.stderr.write(`Rendered ${total}/${total}\n`);
console.log(out);

function wavFile(pcm, rate, channels) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
