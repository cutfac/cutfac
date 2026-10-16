import { execFile, spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { app } from "electron";

import { HOST } from "./ports.ts";

const PATH_MARKER = "__FACTORY_PATH__";

const limits = {
  healthTimeoutMs: 20_000,
  healthPollMs: 150,
  stopGraceMs: 3_000,
  shellPathTimeoutMs: 5_000,
  outputTailLines: 40,
};

const execFileAsync = promisify(execFile);

export interface Sidecar {
  url: string;
  /** SIGTERM, then SIGKILL after a grace period. Resolves once the process is gone. */
  stop: () => Promise<void>;
  /** Synchronous SIGKILL for the process-exit hook. */
  kill: () => void;
}

export interface SidecarOptions {
  workspace: string;
  port: number;
  /** Called with an explanation and the output tail if the server dies without `stop()`. */
  onCrash: (message: string) => void;
  /** Restart the server in place when its source changes, if it runs from source. */
  watch: boolean;
}

interface Launch {
  command: string;
  args: string[];
  webDir: string;
  /** Flags that make the server restart itself when its source changes; empty for a binary. */
  watchFlags: string[];
}

interface Running {
  child: ChildProcess;
  tail: string[];
  /** Set once the process exited or failed to spawn. */
  endReason: string | undefined;
  /** Settles when the process has exited or failed to spawn. */
  ended: Promise<void>;
  /** Settles once stdio is drained as well, so the output tail is complete. */
  drained: Promise<void>;
}

let loginPath: Promise<string> | undefined;

/**
 * GUI apps on macOS start with a minimal PATH, but the server spawns claude, codex, ffmpeg and
 * yt-dlp, so ask the user's login shell what PATH a terminal would have.
 */
export function resolveLoginPath(): Promise<string> {
  loginPath ??= readLoginPath();

  return loginPath;
}

async function readLoginPath(): Promise<string> {
  const extras = ["/opt/homebrew/bin", "/usr/local/bin", path.join(homedir(), ".bun", "bin")];
  const fallback = [process.env.PATH, ...extras].filter(Boolean).join(path.delimiter);
  const shell = process.env.SHELL;

  if (!shell || process.platform === "win32") return fallback;

  try {
    // Interactive shells may print banners or rc output, so the PATH is fenced by markers.
    const { stdout } = await execFileAsync(
      shell,
      ["-ilc", `printf '${PATH_MARKER}%s${PATH_MARKER}' "$PATH"`],
      { timeout: limits.shellPathTimeoutMs, encoding: "utf8" },
    );

    const [, value] = stdout.split(PATH_MARKER);

    // The shell appends its additions to the PATH it inherited, so entries repeat.
    return value ? [...new Set(value.split(path.delimiter))].join(path.delimiter) : fallback;
  } catch (error) {
    console.warn("[desktop] Could not read the login shell PATH, using a fallback:", error);

    return fallback;
  }
}

function findExecutable(name: string, searchPath: string): string {
  for (const dir of searchPath.split(path.delimiter)) {
    const candidate = path.join(dir, name);

    if (dir && statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }

  throw new Error(`\`${name}\` is not on PATH. Install Bun (https://bun.sh) to run from source.`);
}

/**
 * FACTORY_SIDECAR points at any executable that speaks the sidecar CLI (used to test the shell
 * without the real server). Otherwise: the compiled binary in the packaged app, `bun src/cli.ts`
 * from a checkout.
 */
function resolveLaunch(searchPath: string): Launch {
  const override = process.env.FACTORY_SIDECAR;

  if (app.isPackaged) {
    const resources = process.resourcesPath;

    return {
      command: override || path.join(resources, "bin", "factory"),
      args: [],
      webDir: path.join(resources, "web"),
      watchFlags: [],
    };
  }

  const root = app.getAppPath();
  const webDir = path.join(root, "dist", "web");

  if (override) return { command: override, args: [], webDir, watchFlags: [] };

  return {
    command: findExecutable("bun", searchPath),
    args: [path.join(root, "src", "cli.ts")],
    webDir,
    // Bun re-executes in place, so the process (and the app's handle on it) survives a reload.
    watchFlags: ["--watch"],
  };
}

function forward(stream: Readable, log: (line: string) => void, tail: string[]): void {
  createInterface({ input: stream }).on("line", (line) => {
    tail.push(line);

    if (tail.length > limits.outputTailLines) tail.shift();

    log(`[sidecar] ${line}`);
  });
}

function run(launch: Launch, args: string[], workspace: string, searchPath: string): Running {
  const child = spawn(launch.command, [...launch.args, ...args], {
    cwd: workspace,
    env: { ...process.env, PATH: searchPath },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const tail: string[] = [];

  forward(child.stdout, console.log, tail);
  forward(child.stderr, console.error, tail);

  const running: Running = {
    child,
    tail,
    endReason: undefined,
    ended: new Promise((resolve) => {
      child.once("error", (error) => {
        running.endReason = `could not be started (${error.message})`;
        resolve();
      });
      child.once("exit", (code, signal) => {
        running.endReason = signal ? `was killed by ${signal}` : `exited with code ${code}`;
        resolve();
      });
    }),
    drained: new Promise((resolve) => {
      child.once("error", () => resolve());
      child.once("close", () => resolve());
    }),
  };

  return running;
}

async function describeEnd(running: Running, what: string): Promise<string> {
  // The exit event can beat the last stdout/stderr lines, and a grandchild may hold the pipes open.
  await Promise.race([running.drained, delay(500)]);

  const output = running.tail.length > 0 ? `\n\nLast output:\n${running.tail.join("\n")}` : "";

  return `${what} ${running.endReason ?? "ended"}.${output}`;
}

async function ping(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });

    return response.ok;
  } catch {
    // Nothing is listening yet.
    return false;
  }
}

async function waitUntilHealthy(url: string, running: Running): Promise<void> {
  const deadline = Date.now() + limits.healthTimeoutMs;

  while (Date.now() < deadline) {
    if (running.endReason !== undefined) {
      throw new Error(await describeEnd(running, "The local server"));
    }

    if (await ping(url)) return;

    await delay(limits.healthPollMs);
  }

  await terminate(running);
  throw new Error(
    await describeEnd(
      running,
      `The local server did not answer within ${limits.healthTimeoutMs / 1_000}s and`,
    ),
  );
}

async function terminate(running: Running): Promise<void> {
  if (running.endReason !== undefined) return;

  running.child.kill("SIGTERM");

  const timer = setTimeout(() => running.child.kill("SIGKILL"), limits.stopGraceMs);

  await running.ended;
  clearTimeout(timer);
}

/** Initialises the workspace if needed, starts the server on it and resolves once it is healthy. */
export async function startSidecar({
  workspace,
  port,
  onCrash,
  watch,
}: SidecarOptions): Promise<Sidecar> {
  const searchPath = await resolveLoginPath();
  const launch = resolveLaunch(searchPath);

  if (!existsSync(path.join(workspace, "factory.yaml"))) {
    const init = run(launch, ["init", workspace, "--no-connect"], workspace, searchPath);

    await init.ended;

    if (init.child.exitCode !== 0) {
      throw new Error(await describeEnd(init, "Workspace setup"));
    }
  }

  const serve = run(
    watch ? { ...launch, args: [...launch.watchFlags, ...launch.args] } : launch,
    [
      "serve",
      "--workspace",
      workspace,
      "--port",
      String(port),
      "--host",
      HOST,
      "--web-dir",
      launch.webDir,
    ],
    workspace,
    searchPath,
  );

  const url = `http://${HOST}:${port}/`;

  await waitUntilHealthy(`${url}api/health`, serve);

  let stopping = false;

  void serve.ended.then(async () => {
    if (!stopping) onCrash(await describeEnd(serve, "The local server"));
  });

  return {
    url,
    stop: () => {
      stopping = true;

      return terminate(serve);
    },
    kill: () => {
      serve.child.kill("SIGKILL");
    },
  };
}
