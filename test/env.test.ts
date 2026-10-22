import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  cleanEnv,
  joinPath,
  parseEnv,
  readShellEnv,
  serverEnv,
  type Account,
} from "../electron/env.ts";

const ACCOUNT: Account = {
  home: "/Users/ada",
  user: "ada",
  shell: "/bin/zsh",
  tmpdir: "/var/folders/xy/T/",
};

/** What `open --env` or `launchctl setenv` could hand the app. */
const LAUNCH_ENV = {
  PATH: "/tmp/evil/bin",
  HOME: "/tmp/evil",
  SHELL: "/tmp/evil/sh",
  TMPDIR: "/tmp/evil/tmp",
  ZDOTDIR: "/tmp/evil",
  BUN_OPTIONS: "--preload /tmp/evil/pre.js",
  DYLD_INSERT_LIBRARIES: "/tmp/evil/lib.dylib",
  NODE_OPTIONS: "--require /tmp/evil/pre.js",
  SSH_AUTH_SOCK: "/private/tmp/com.apple.launchd.abc/Listeners",
};

const fenced = (entries: string[]) =>
  `Last login: today\n__CUTFAC_ENV__${entries.map((entry) => `${entry}\0`).join("")}__CUTFAC_ENV__bye\n`;

describe("the server's environment in the packaged app", () => {
  test("the clean start comes from the account; only the ssh agent comes from the launch", () => {
    expect(cleanEnv(ACCOUNT, LAUNCH_ENV)).toEqual({
      HOME: "/Users/ada",
      USER: "ada",
      LOGNAME: "ada",
      SHELL: "/bin/zsh",
      TMPDIR: "/var/folders/xy/T/",
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin:/Users/ada/.bun/bin:/Users/ada/.local/bin",
      SSH_AUTH_SOCK: "/private/tmp/com.apple.launchd.abc/Listeners",
    });
    expect(cleanEnv({ ...ACCOUNT, shell: undefined, tmpdir: undefined }, {})).not.toContainKeys([
      "SHELL",
      "TMPDIR",
      "SSH_AUTH_SOCK",
    ]);
  });

  test("the shell's output is read between the markers, whatever its files print", () => {
    expect(parseEnv(fenced(["A=1", "B=x=y", "MULTI=one\ntwo", "EMPTY="]))).toEqual({
      A: "1",
      B: "x=y",
      MULTI: "one\ntwo",
      EMPTY: "",
    });
    expect(parseEnv("zsh: command not found: env\n")).toBeUndefined();
    expect(parseEnv("__CUTFAC_ENV__A=1\0")).toBeUndefined();
  });

  test("keys and settings from the shell reach agents; Bun and dyld switches don't", () => {
    const clean = cleanEnv(ACCOUNT, LAUNCH_ENV);

    const shell = parseEnv(
      fenced([
        "HOME=/Users/ada",
        "PATH=/Users/ada/.local/bin:/opt/homebrew/bin:/usr/bin:/bin",
        "ANTHROPIC_API_KEY=sk-test",
        "CODEX_HOME=/Users/ada/.codex",
        "NODE_OPTIONS=--max-old-space-size=4096",
        "BUN_INSTALL=/Users/ada/.bun",
        "BUN_OPTIONS=--smol",
        "BUN_BE_BUN=1",
        "DYLD_LIBRARY_PATH=/opt/lib",
        "PWD=/Users/ada",
        "OLDPWD=/",
        "SHLVL=1",
        "_=/usr/bin/env",
      ]),
    );

    const env = serverEnv(shell, clean);

    expect(env).toMatchObject({
      ANTHROPIC_API_KEY: "sk-test",
      CODEX_HOME: "/Users/ada/.codex",
      NODE_OPTIONS: "--max-old-space-size=4096",
      BUN_INSTALL: "/Users/ada/.bun",
      TMPDIR: "/var/folders/xy/T/",
    });
    expect(env).not.toContainAnyKeys([
      "BUN_OPTIONS",
      "BUN_BE_BUN",
      "DYLD_LIBRARY_PATH",
      "PWD",
      "OLDPWD",
      "SHLVL",
      "_",
    ]);
    // The shell's order first, then what it lacked, each once.
    expect(env.PATH).toBe(
      "/Users/ada/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/Users/ada/.bun/bin",
    );
  });

  test("without a readable shell the server gets the clean start and nothing launched with it", () => {
    const clean = cleanEnv(ACCOUNT, LAUNCH_ENV);

    expect(serverEnv(undefined, clean)).toEqual(clean);
  });

  test("PATH entries keep their order, once each, without empty ones", () => {
    expect(joinPath("/a:/b:", undefined, "/b:/c", "", "/a")).toBe("/a:/b:/c");
  });
});

describe("reading the login shell", () => {
  let dir = "";

  beforeAll(async () => {
    // The shell reports where it is with symlinks resolved, as /private/var rather than /var.
    dir = await realpath(await mkdtemp(join(tmpdir(), "cutfac-env-")));
  });

  afterAll(() => rm(dir, { recursive: true, force: true }));

  /** A shell that prints a banner, then runs the command it is given after `-ilc`. */
  async function fakeShell(body: string): Promise<string> {
    const file = join(dir, `shell-${Math.random().toString(36).slice(2)}`);

    await writeFile(file, `#!/bin/sh\n${body}\n`);
    await chmod(file, 0o755);

    return file;
  }

  test("the shell starts in the home folder from the clean environment alone", async () => {
    const shell = await fakeShell('echo "welcome"\n[ "$1" = "-ilc" ] && eval "$2"');

    process.env.CUTFAC_LAUNCH_PROBE = "1";

    try {
      const env = await readShellEnv(shell, cleanEnv({ ...ACCOUNT, home: dir }, {}));

      expect(env).toMatchObject({ HOME: dir, USER: "ada", PWD: dir });
      expect(env).not.toContainKey("CUTFAC_LAUNCH_PROBE");
    } finally {
      Reflect.deleteProperty(process.env, "CUTFAC_LAUNCH_PROBE");
    }
  });

  test("a shell that fails or prints nothing readable gives no environment", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const clean = cleanEnv({ ...ACCOUNT, home: dir }, {});

    try {
      expect(await readShellEnv(await fakeShell("exit 3"), clean)).toBeUndefined();
      expect(await readShellEnv(await fakeShell("echo hi"), clean)).toBeUndefined();
      expect(await readShellEnv(join(dir, "missing"), clean)).toBeUndefined();
    } finally {
      warn.mockRestore();
    }
  });
});
