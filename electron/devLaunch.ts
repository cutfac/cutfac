/**
 * Starts the dev app for `bun run desktop:dev`. On macOS it goes through Launch Services, as a
 * Finder double-click does, so the app is the one macOS answers for: a permission granted to
 * Cutfac Dev, such as Full Disk Access, then holds. Spawned straight from a terminal, macOS would
 * ask the terminal's permissions instead, and the grant would never show.
 */
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const limits = { pidWaitMs: 15_000, pidPollMs: 100 };

/** A running dev app, however it was started. */
export interface AppProcess {
  /** Resolves once the app is up, or to undefined if it never showed. */
  pid: Promise<number | undefined>;
  /** Resolves when the app has quit. */
  exited: Promise<number>;
  kill: (signal: NodeJS.Signals) => void;
}

interface Launch {
  /** The app's executable: inside the dev bundle on macOS, or stock Electron. */
  executable: string;
  /** The app's code, the repository's root. */
  root: string;
  /** Switches for Electron after the app's path. */
  args: string[];
  /** What the app needs to find the dev server and the board. */
  env: Record<string, string>;
}

/** The `.app` an executable lives in, when it lives in one. */
const bundleOf = (executable: string) => {
  const bundle = path.resolve(executable, "..", "..", "..");

  return bundle.endsWith(".app") ? bundle : undefined;
};

export function launchApp(launch: Launch): AppProcess {
  const bundle = process.platform === "darwin" ? bundleOf(launch.executable) : undefined;

  return bundle === undefined ? spawnApp(launch) : openApp(bundle, launch);
}

/** Stock Electron, or another platform: a plain child, which owns its permissions there. */
function spawnApp({ executable, root, args, env }: Launch): AppProcess {
  const child = Bun.spawn([executable, root, ...args], {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "inherit", "inherit"],
  });

  return {
    pid: Promise.resolve(child.pid),
    exited: child.exited,
    kill: (signal) => process.kill(child.pid, signal),
  };
}

/**
 * Through `open`, which waits until the app quits. Its output comes back over a named pipe, so it
 * still shows in this terminal. `open` doesn't say which process it started, so the app is found by
 * its executable and its argument, which no other app has.
 */
function openApp(bundle: string, { executable, root, args, env }: Launch): AppProcess {
  const pipe = makePipe();

  const opened = pipe.then((fifo) =>
    Bun.spawn(
      [
        "open",
        "-n",
        "-W",
        "-a",
        bundle,
        ...Object.entries(env).flatMap(([key, value]) => ["--env", `${key}=${value}`]),
        "--stdout",
        fifo.file,
        "--stderr",
        fifo.file,
        "--args",
        root,
        ...args,
      ],
      { stdio: ["ignore", "inherit", "inherit"] },
    ),
  );

  const exited = opened.then(async (child) => {
    const code = await child.exited;

    await pipe.then((fifo) => fifo.remove());

    return code;
  });

  const pid = findPid([executable, root, ...args].join(" "), exited);

  return {
    pid,
    exited,
    kill: (signal) => {
      void pid.then((found) => {
        if (found === undefined) return;

        try {
          process.kill(found, signal);
        } catch {
          // It quit already.
        }
      });
    },
  };
}

/** A named pipe whose every line goes to this terminal, for the app to write its output to. */
async function makePipe(): Promise<{ file: string; remove: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), "cutfac-dev-"));
  const file = path.join(dir, "output");

  if ((await Bun.spawn(["mkfifo", file]).exited) !== 0) throw new Error(`mkfifo ${file} failed`);

  // Opening it waits for the app to open its end, so this doesn't hold anything up.
  createReadStream(file).pipe(process.stdout, { end: false });

  return { file, remove: () => rm(dir, { recursive: true, force: true }) };
}

/** The process whose command line is `command`, once the app has started it. */
async function findPid(command: string, exited: Promise<number>): Promise<number | undefined> {
  const app = { quit: false };

  void exited.then(() => (app.quit = true));

  const deadline = Date.now() + limits.pidWaitMs;

  while (!app.quit && Date.now() < deadline) {
    const child = Bun.spawn(["pgrep", "-n", "-f", `^${escapeRegex(command)}$`], { stdout: "pipe" });
    const found = Number.parseInt(await new Response(child.stdout).text(), 10);

    if (Number.isInteger(found)) return found;

    await delay(limits.pidPollMs);
  }

  return undefined;
}

const escapeRegex = (text: string) => text.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&");
