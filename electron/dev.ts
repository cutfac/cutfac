/**
 * `bun run desktop:dev`: the desktop app on live code. Vite serves the board with hot reload, the
 * server restarts itself when src/ changes, and the app restarts when electron/ changes. Closing the
 * app or Ctrl+C stops everything.
 */
import { watch } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import type { Subprocess } from "bun";

import { DEV_APP, devElectron } from "./devApp.ts";
import { probePort } from "./ports.ts";

const root = path.resolve(import.meta.dir, "..");

const limits = { viteReadyMs: 30_000, vitePollMs: 150, restartDebounceMs: 300 };

const bin = (name: string) => path.join(root, "node_modules", ".bin", name);

const log = (message: string) => console.log(`[desktop:dev] ${message}`);

// Never a fixed default: 4317 is what `cutfac serve` uses, and it may be someone's real board.
const serverPort = process.env.CUTFAC_PORT
  ? Number.parseInt(process.env.CUTFAC_PORT, 10)
  : await probePort(0);

let vitePort = await probePort(0);

while (vitePort === serverPort) vitePort = await probePort(0);

const devUrl = `http://localhost:${vitePort}`;

const env = { ...process.env, CUTFAC_PORT: String(serverPort), CUTFAC_DEV_URL: devUrl };

const spawnLogged = (command: string[]) =>
  Bun.spawn(command, { cwd: root, env, stdio: ["ignore", "inherit", "inherit"] });

const vite = spawnLogged([bin("vite"), "--port", String(vitePort), "--strictPort"]);

let electron: Subprocess | undefined;

let stopping = false;

async function stop(code: number): Promise<never> {
  if (!stopping) {
    stopping = true;
    electron?.kill("SIGTERM");
    vite.kill("SIGTERM");
    await Promise.all([electron?.exited, vite.exited]);
  }

  process.exit(code);
}

process.on("SIGINT", () => void stop(130));

process.on("SIGTERM", () => void stop(143));

void vite.exited.then((code) => {
  if (stopping) return;

  log(`Vite exited with code ${code}.`);
  void stop(1);
});

async function waitForVite(): Promise<void> {
  const deadline = Date.now() + limits.viteReadyMs;

  while (Date.now() < deadline) {
    try {
      if ((await fetch(devUrl, { signal: AbortSignal.timeout(1_000) })).ok) return;
    } catch {
      // Not listening yet.
    }

    await delay(limits.vitePollMs);
  }

  log(`Vite did not answer on ${devUrl} within ${limits.viteReadyMs / 1_000}s.`);
  await stop(1);
}

async function buildElectron(): Promise<boolean> {
  return (await spawnLogged(["bun", "run", "build:electron"]).exited) === 0;
}

// A failed copy is no reason to stop working: run stock Electron instead.
async function electronExecutable(): Promise<string> {
  if (process.platform !== "darwin") return bin("electron");

  try {
    return await devElectron(root);
  } catch (error) {
    log(`Could not set up ${DEV_APP.name}, running stock Electron: ${String(error)}`);

    return bin("electron");
  }
}

// Built while Vite starts.
const executable = electronExecutable();

async function launch(): Promise<void> {
  const command = [await executable, "."];

  if (stopping) return;

  const child = spawnLogged(command);

  electron = child;

  // The app quit by itself (window closed or Cmd+Q), not for a restart: wind everything down.
  void child.exited.then((code) => {
    if (electron === child) void stop(code);
  });
}

async function restart(): Promise<void> {
  if (stopping) return;

  log("electron/ changed, rebuilding.");

  // A broken build keeps the running app; the next save tries again.
  if (!(await buildElectron())) return;

  const previous = electron;

  electron = undefined;
  previous?.kill("SIGTERM");
  // The app holds a single-instance lock and the server port until it has quit.
  await previous?.exited;

  if (!stopping) await launch();
}

let restarts = Promise.resolve();

let pending: ReturnType<typeof setTimeout> | undefined;

// The app does not run these, so a change to them is no reason to restart it.
const devScripts = new Set([path.basename(import.meta.path), "devApp.ts"]);

watch(path.join(root, "electron"), { recursive: true }, (_event, file) => {
  if (!file?.endsWith(".ts") || devScripts.has(file)) return;

  clearTimeout(pending);
  pending = setTimeout(() => {
    restarts = restarts.then(restart);
  }, limits.restartDebounceMs);
});

await waitForVite();

if (!(await buildElectron())) await stop(1);

log(`Board on ${devUrl}, server on port ${serverPort}.`);

await launch();
