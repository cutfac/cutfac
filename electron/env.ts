import { execFile } from "node:child_process";
import { userInfo } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const ENV_MARKER = "__CUTFAC_ENV__";

/** What launchd gives GUI apps before anything else is added. */
const SYSTEM_PATH = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];

/** Shell bookkeeping that would describe the shell that printed the environment, not the server. */
const SHELL_STATE = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

const shellTimeoutMs = 5_000;

const execFileAsync = promisify(execFile);

export type Env = Record<string, string>;

/** Who the app runs as, from the user database rather than the environment it was launched with. */
export interface Account {
  home: string;
  user: string;
  shell: string | undefined;
  /** The per-user temporary folder macOS assigns, when the system reports one. */
  tmpdir: string | undefined;
}

export async function readAccount(): Promise<Account> {
  const { homedir, username, shell } = userInfo();

  const tmpdir = await execFileAsync("/usr/bin/getconf", ["DARWIN_USER_TEMP_DIR"], {
    encoding: "utf8",
  }).then(
    ({ stdout }) => stdout.trim() || undefined,
    // Not macOS; programs fall back to /tmp.
    () => undefined,
  );

  return { home: homedir, user: username, shell: shell ?? undefined, tmpdir };
}

/** PATH entries in order, without repeats or empty entries. */
export function joinPath(...paths: (string | undefined)[]): string {
  const entries = paths.flatMap((value) => value?.split(path.delimiter) ?? []);

  return [...new Set(entries.filter(Boolean))].join(path.delimiter);
}

/**
 * What a fresh terminal has before the user's shell files run, built only from the account, so
 * nothing in the environment the app was launched with gets through.
 */
export interface CleanEnv {
  HOME: string;
  USER: string;
  LOGNAME: string;
  /** The system folders, then Homebrew, Bun and the agents' own installs in case the shell can't be read. */
  PATH: string;
  SHELL?: string;
  TMPDIR?: string;
  /** The session's ssh agent, which launchd hands every app, so agents can still use git over ssh. */
  SSH_AUTH_SOCK?: string;
}

export function cleanEnv(account: Account, inherited: NodeJS.ProcessEnv): CleanEnv {
  const env: CleanEnv = {
    HOME: account.home,
    USER: account.user,
    LOGNAME: account.user,
    PATH: joinPath(
      ...SYSTEM_PATH,
      "/opt/homebrew/bin",
      "/usr/local/bin",
      path.join(account.home, ".bun", "bin"),
      // Where the Claude Code and Codex installers put their programs, before a new shell has it.
      path.join(account.home, ".local", "bin"),
    ),
  };

  if (account.shell) env.SHELL = account.shell;

  if (account.tmpdir) env.TMPDIR = account.tmpdir;

  if (inherited.SSH_AUTH_SOCK) env.SSH_AUTH_SOCK = inherited.SSH_AUTH_SOCK;

  return env;
}

/** Reads the `env -0` output fenced by markers, ignoring whatever the shell's files printed. */
export function parseEnv(output: string): Env | undefined {
  const start = output.indexOf(ENV_MARKER);
  const end = output.lastIndexOf(ENV_MARKER);

  if (start === -1 || end === start) return undefined;

  const env: Env = {};

  for (const entry of output.slice(start + ENV_MARKER.length, end).split("\0")) {
    const equals = entry.indexOf("=");

    if (equals > 0) env[entry.slice(0, equals)] = entry.slice(equals + 1);
  }

  return env;
}

/**
 * GUI apps on macOS start with launchd's minimal environment, but agents expect what a terminal
 * gives them: the PATH to claude, codex, ffmpeg and yt-dlp, API keys and tool settings. So the
 * user's login shell starts from `clean` in their home folder, as a terminal would, and prints its
 * environment. Undefined if the shell can't be run or printed nothing readable.
 */
export async function readShellEnv(shell: string, clean: CleanEnv): Promise<Env | undefined> {
  const marker = `printf '%s' ${ENV_MARKER}`;

  try {
    const { stdout } = await execFileAsync(
      shell,
      ["-ilc", `${marker}; /usr/bin/env -0; ${marker}`],
      {
        cwd: clean.HOME,
        env: { ...clean },
        timeout: shellTimeoutMs,
        encoding: "utf8",
      },
    );

    return parseEnv(stdout);
  } catch (error) {
    console.warn("[desktop] Could not read the login shell environment:", error);

    return undefined;
  }
}

/**
 * The server's environment: the login shell's, or `clean` when it couldn't be read. The server is a
 * Bun binary, which takes options from BUN_* variables (BUN_OPTIONS can preload a script and
 * BUN_BE_BUN turns it into the bun command), and it and many tools agents run let DYLD_* variables
 * load libraries into them. Neither belongs in a terminal's environment, so both are dropped,
 * except BUN_INSTALL, which only tells `bun` where it's installed.
 */
export function serverEnv(shell: Env | undefined, clean: CleanEnv) {
  const kept = Object.entries({ ...clean, ...shell }).filter(([name]) => !isDropped(name));

  return { ...Object.fromEntries(kept), PATH: joinPath(shell?.PATH, clean.PATH) };
}

function isDropped(name: string): boolean {
  if (name === "BUN_INSTALL") return false;

  return name.startsWith("BUN_") || name.startsWith("DYLD_") || SHELL_STATE.has(name);
}
