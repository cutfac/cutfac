import { describe, expect, test } from "bun:test";
import { userInfo } from "node:os";
import { join } from "node:path";

// Each check runs its shell to the end, so it is the entry point that provides layers.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Effect, Fiber, FileSystem, Option } from "effect";
import { TestClock } from "effect/testing";

import {
  cleanEnv,
  joinPath,
  parseEnv,
  readAccount,
  readShellEnv,
  serverEnv,
  type Account,
} from "../electron/env.ts";
import { eventually, testEffect } from "./effect.ts";
import { alive, killedAfter } from "./support.ts";

const it = testEffect(BunServices.layer);

const ACCOUNT: Account = {
  home: "/Users/ada",
  user: "ada",
  shell: Option.some("/bin/zsh"),
  tmpdir: Option.some("/var/folders/xy/T/"),
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
    expect(
      cleanEnv({ ...ACCOUNT, shell: Option.none(), tmpdir: Option.none() }, {}),
    ).not.toContainKeys(["SHELL", "TMPDIR", "SSH_AUTH_SOCK"]);
  });

  test("the shell's output is read between the markers, whatever its files print", () => {
    expect(parseEnv(fenced(["A=1", "B=x=y", "MULTI=one\ntwo", "EMPTY="]))).toEqual(
      Option.some({ A: "1", B: "x=y", MULTI: "one\ntwo", EMPTY: "" }),
    );
    expect(parseEnv("zsh: command not found: env\n")).toEqual(Option.none());
    expect(parseEnv("__CUTFAC_ENV__A=1\0")).toEqual(Option.none());
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

    expect(serverEnv(Option.none(), clean)).toEqual(clean);
  });

  test("PATH entries keep their order, once each, without empty ones", () => {
    expect(joinPath("/a:/b:", undefined, "/b:/c", "", "/a")).toBe("/a:/b:/c");
  });
});

describe("reading the account", () => {
  it.live("takes the home folder and user from the user database, not the launch's HOME", () =>
    Effect.gen(function* () {
      const home = process.env["HOME"];

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.env["HOME"] = "/tmp/evil";
        }),
        () => Effect.sync(() => void (process.env["HOME"] = home)),
      );

      const account = yield* readAccount;
      const user = userInfo();

      expect(account.home).toBe(user.homedir);
      expect(account.home).not.toBe("/tmp/evil");
      expect(account.user).toBe(user.username);
      // macOS reports a per-user temporary folder; elsewhere there is none to give.
      expect(Option.isSome(account.tmpdir)).toBe(process.platform === "darwin");
    }),
  );
});

describe("reading the login shell", () => {
  /** A folder for the test, as the shell reports it, with symlinks resolved. */
  const home = Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-env-" }));
  });

  /** A shell in `dir` that runs `body`, with the command it is given after `-ilc` as `$2`. */
  const fakeShell = Effect.fnUntraced(function* (dir: string, name: string, body: string) {
    const fs = yield* FileSystem.FileSystem;
    const file = join(dir, name);

    yield* fs.writeFileString(file, `#!/bin/sh\n${body}\n`);
    yield* fs.chmod(file, 0o755);

    return file;
  });

  it.live("the shell starts in the home folder from the clean environment alone", () =>
    Effect.gen(function* () {
      const dir = yield* home;

      const shell = yield* fakeShell(
        dir,
        "shell",
        'echo "welcome"\n[ "$1" = "-ilc" ] && eval "$2"',
      );

      // Set on this process, which the shell would see if it inherited the app's environment.
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.env["CUTFAC_LAUNCH_PROBE"] = "1";
        }),
        () => Effect.sync(() => void Reflect.deleteProperty(process.env, "CUTFAC_LAUNCH_PROBE")),
      );

      const env = Option.getOrThrow(
        yield* readShellEnv(shell, cleanEnv({ ...ACCOUNT, home: dir }, {})),
      );

      expect(env).toMatchObject({ HOME: dir, USER: "ada", PWD: dir });
      expect(env).not.toContainKey("CUTFAC_LAUNCH_PROBE");
    }),
  );

  it.live("a shell that fails or prints nothing readable gives no environment", () =>
    Effect.gen(function* () {
      const dir = yield* home;
      const clean = cleanEnv({ ...ACCOUNT, home: dir }, {});

      const read = (shell: string) => readShellEnv(shell, clean);

      // It prints its environment, then fails: what it printed doesn't count.
      const fails = yield* fakeShell(dir, "fails", 'eval "$2"\nexit 3');

      expect(yield* read(fails)).toEqual(Option.none());
      expect(yield* read(yield* fakeShell(dir, "unreadable", "echo hi"))).toEqual(Option.none());
      expect(yield* read(join(dir, "missing"))).toEqual(Option.none());
    }),
  );

  it.live("leaves running what the shell's files start in the background", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* home;
      const pidFile = join(dir, "pid");

      const shell = yield* fakeShell(
        dir,
        "starts-an-agent",
        `sleep 30 > /dev/null 2>&1 &\necho $! > "${pidFile}"\neval "$2"`,
      );

      expect(
        Option.isSome(yield* readShellEnv(shell, cleanEnv({ ...ACCOUNT, home: dir }, {}))),
      ).toBe(true);

      const pid = Number((yield* fs.readFileString(pidFile)).trim());

      yield* killedAfter(pid);
      // A brief wait, as the spawner signals a process group as the shell's scope closes.
      yield* Effect.sleep("100 millis");

      expect(yield* alive(pid)).toBe(true);
    }),
  );

  it.effect("a shell that never finishes is given up on after five seconds", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* home;
      const started = join(dir, "started");
      const shell = yield* fakeShell(dir, "waits", `touch "${started}"\nexec sleep 60`);

      const reading = yield* Effect.forkScoped(
        readShellEnv(shell, cleanEnv({ ...ACCOUNT, home: dir }, {})),
      );

      yield* eventually(fs.exists(started));

      yield* TestClock.adjust("5 seconds");

      expect(yield* Fiber.join(reading)).toEqual(Option.none());
    }),
  );
});
