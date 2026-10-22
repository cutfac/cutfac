import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";

import { app } from "electron";

import { cleanEnv, joinPath, readAccount, readShellEnv, serverEnv } from "./env.ts";
import { HOST } from "./ports.ts";

const limits = {
  cliTimeoutMs: 30_000,
  healthTimeoutMs: 20_000,
  healthPollMs: 150,
  stopGraceMs: 3_000,
  outputTailLines: 40,
};

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

let launchEnv: Promise<NodeJS.ProcessEnv> | undefined;

/**
 * The packaged app gives the server its user's terminal environment and nothing from the
 * environment it was launched with, so another program can't open it with variables that make
 * the server, or the agents it runs, load their code under the app's permissions. From a checkout
 * the app was started from the developer's own terminal or editor, so that is kept and only the
 * PATH is widened.
 */
export function resolveServerEnv(): Promise<NodeJS.ProcessEnv> {
  launchEnv ??= readServerEnv();

  return launchEnv;
}

async function readServerEnv(): Promise<NodeJS.ProcessEnv> {
  // The desktop app ships for macOS only; elsewhere there's no login shell to ask.
  if (process.platform === "win32") return process.env;

  const account = await readAccount();
  const clean = cleanEnv(account, process.env);
  const shell = account.shell ? await readShellEnv(account.shell, clean) : undefined;
  const env = serverEnv(shell, clean);

  if (app.isPackaged) return env;

  return { ...process.env, PATH: joinPath(process.env.PATH, env.PATH) };
}

function findExecutable(name: string, searchPath: string): string {
  for (const dir of searchPath.split(path.delimiter)) {
    const candidate = path.join(dir, name);

    if (dir && statSync(candidate, { throwIfNoEntry: false })?.isFile()) return candidate;
  }

  throw new Error(`\`${name}\` is not on PATH. Install Bun (https://bun.sh) to run from source.`);
}

/** The built board, which the server serves and the first launch loads before there is one. */
export function boardDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "web")
    : path.join(app.getAppPath(), "dist", "web");
}

/**
 * The compiled binary in the packaged app, `bun src/cli.ts` from a checkout. From a checkout,
 * CUTFAC_SIDECAR points at any executable that speaks the sidecar CLI (used to test the shell
 * without the real server); the packaged app runs only its own.
 */
function resolveLaunch(env: NodeJS.ProcessEnv): Launch {
  if (app.isPackaged) {
    const resources = process.resourcesPath;

    return {
      command: path.join(resources, "bin", "cutfac"),
      args: [],
      webDir: boardDir(),
      watchFlags: [],
    };
  }

  const root = app.getAppPath();
  const webDir = boardDir();
  const override = process.env.CUTFAC_SIDECAR;

  if (override) return { command: override, args: [], webDir, watchFlags: [] };

  return {
    command: findExecutable("bun", env.PATH ?? ""),
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

function run(launch: Launch, args: string[], workspace: string, env: NodeJS.ProcessEnv): Running {
  const child = spawn(launch.command, [...launch.args, ...args], {
    cwd: workspace,
    env,
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

/**
 * Runs a command that needs no workspace, such as `agents --json`, and resolves what it printed.
 * One that hangs is killed, and resolves with what it printed so far.
 */
export async function runCli(args: string[]): Promise<{ code: number | null; stdout: string }> {
  const env = await resolveServerEnv();
  const launch = resolveLaunch(env);

  const child = spawn(launch.command, [...launch.args, ...args], {
    cwd: app.getPath("home"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const timer = setTimeout(() => child.kill("SIGKILL"), limits.cliTimeoutMs);
  let stdout = "";

  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
  });
  forward(child.stderr, console.error, []);

  return new Promise((resolve, reject) => {
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout });
    });
  });
}

/** Initialises the workspace if needed, starts the server on it and resolves once it is healthy. */
export async function startSidecar({
  workspace,
  port,
  onCrash,
  watch,
}: SidecarOptions): Promise<Sidecar> {
  const env = await resolveServerEnv();
  const launch = resolveLaunch(env);

  // factory.yaml is what a workspace made before the rename to Cutfac calls it; serving renames it.
  const configs = ["cutfac.yaml", "factory.yaml"].map((name) => path.join(workspace, name));

  if (!configs.some((file) => existsSync(file))) {
    const init = run(launch, ["init", workspace, "--no-connect"], workspace, env);

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
    env,
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
