import { describe, expect } from "bun:test";
import path from "node:path";

// Each check builds the fixes for its own folder and agents.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { Effect, Fiber, FileSystem, Layer, Option, Ref } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";

import { AgentFixes } from "../electron/agents.ts";
import { Install, ServerEnv } from "../electron/sidecar.ts";
import { testEffect } from "./effect.ts";
import { fakeSidecar } from "./fakeSidecar.ts";

const it = testEffect(Layer.mergeAll(BunServices.layer, FetchHttpClient.layer));

/** The fixes, as a run from a checkout whose server's check names `fixes`. */
const fixesFor = (
  dir: string,
  fake: string,
  fixes: Partial<Record<"claude" | "codex", string>>,
  checkOutput = JSON.stringify(
    (["claude", "codex"] as const).map((agent) => {
      const fix = fixes[agent];

      return fix === undefined ? { agent, state: "ready" } : { agent, state: "missing", fix };
    }),
  ),
) =>
  AgentFixes.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Layer.succeed(
          Install,
          Install.of({
            packaged: false,
            appPath: dir,
            resourcesPath: dir,
            logsPath: dir,
            homePath: dir,
            launchEnv: { CUTFAC_SIDECAR: fake },
            devPort: Option.none(),
          }),
        ),
        Layer.succeed(ServerEnv, {
          PATH: "/bin:/usr/bin",
          FAKE_AGENTS: checkOutput,
        }),
      ),
    ),
  );

/** Runs `fix` for `agent` after a check, keeping the lines it printed. */
const fixWithLines = (agent: "claude" | "codex") =>
  Effect.gen(function* () {
    const agents = yield* AgentFixes;
    const lines = yield* Ref.make<ReadonlyArray<string>>([]);
    const result = yield* agents.fix(agent, (line) => Ref.update(lines, (all) => [...all, line]));

    return { result, lines: yield* Ref.get(lines) };
  });

const exists = (file: string) => Effect.flatMap(FileSystem.FileSystem, (fs) => fs.exists(file));

/** Waits until a fix's shell has written `file`. */
const written = (file: string) =>
  Effect.gen(function* () {
    while (!(yield* exists(file))) yield* Effect.promise(() => Bun.sleep(5));
  });

const alive = (pid: number) =>
  Effect.sync(() => {
    try {
      process.kill(pid, 0);

      return true;
    } catch {
      return false;
    }
  });

describe("fixing an agent", () => {
  it.live("runs only the fix the app's check named, and nothing before a check", () =>
    Effect.gen(function* () {
      const { dir, fake } = yield* fakeSidecar;

      yield* Effect.gen(function* () {
        const agents = yield* AgentFixes;
        const unchecked = yield* Effect.flip(agents.fix("claude", () => Effect.void));

        yield* agents.check;

        const unnamed = yield* Effect.flip(agents.fix("codex", () => Effect.void));
        const named = yield* agents.fix("claude", () => Effect.void);

        expect(unchecked.message).toBe("Nothing to fix for claude");
        expect(unnamed.message).toBe("Nothing to fix for codex");
        expect(named).toEqual({ ok: true, command: "true" });
      }).pipe(Effect.provide(fixesFor(dir, fake, { claude: "true" })));
    }),
  );

  it.live("says so when the check prints something it can't read", () =>
    Effect.gen(function* () {
      const { dir, fake } = yield* fakeSidecar;

      const error = yield* Effect.flatMap(AgentFixes, (agents) => Effect.flip(agents.check)).pipe(
        Effect.provide(fixesFor(dir, fake, {}, "zsh: command not found: cutfac")),
      );

      expect(error.message).toBe("Could not check the agents on this computer");
    }),
  );

  it.live("passes on each line it prints, its progress redraws and colors cleaned up", () =>
    Effect.gen(function* () {
      const { dir, fake } = yield* fakeSidecar;
      const command = String.raw`printf '10%%\r20%%\r\033[32mdone\033[0m\n\n'`;

      const { result, lines } = yield* Effect.andThen(
        Effect.flatMap(AgentFixes, (agents) => agents.check),
        fixWithLines("claude"),
      ).pipe(Effect.provide(fixesFor(dir, fake, { claude: command })));

      expect(lines).toEqual(["10%", "20%", "done"]);
      expect(result).toEqual({ ok: true, command });
    }),
  );

  it.live("says a fix that failed did, with the command it ran", () =>
    Effect.gen(function* () {
      const { dir, fake } = yield* fakeSidecar;
      const command = "echo 'no network' >&2; exit 1";

      const { result, lines } = yield* Effect.andThen(
        Effect.flatMap(AgentFixes, (agents) => agents.check),
        fixWithLines("claude"),
      ).pipe(Effect.provide(fixesFor(dir, fake, { claude: command })));

      expect(result).toEqual({ ok: false, command });
      expect(lines).toEqual(["no network"]);
    }),
  );

  it.live("joins a fix already running instead of starting a second", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, fake } = yield* fakeSidecar;
      const runs = path.join(dir, "runs");

      yield* Effect.gen(function* () {
        const agents = yield* AgentFixes;

        yield* agents.check;

        const [first, second] = yield* Effect.all(
          [agents.fix("claude", () => Effect.void), agents.fix("claude", () => Effect.void)],
          { concurrency: "unbounded" },
        );

        expect(first).toEqual(second);
      }).pipe(Effect.provide(fixesFor(dir, fake, { claude: `echo run >> "${runs}"; sleep 0.2` })));

      expect(yield* fs.readFileString(runs)).toBe("run\n");
    }),
  );
});

describe("stopping fixes", () => {
  it.live("kills a fix and what it started, as the app quits", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, fake } = yield* fakeSidecar;
      const pidFile = path.join(dir, "pid");

      yield* Effect.gen(function* () {
        const agents = yield* AgentFixes;

        yield* agents.check;

        const fixing = yield* Effect.forkScoped(agents.fix("claude", () => Effect.void));

        yield* written(pidFile);

        const installer = Number((yield* fs.readFileString(pidFile)).trim());

        yield* agents.stopAll;

        expect((yield* Fiber.join(fixing)).ok).toBe(false);
        expect(yield* alive(installer)).toBe(false);
      }).pipe(
        Effect.provide(fixesFor(dir, fake, { claude: `sleep 30 & echo $! > "${pidFile}"; wait` })),
      );
    }),
  );

  it.effect("gives up on a fix still running after ten minutes, and kills it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { dir, fake } = yield* fakeSidecar;
      const pidFile = path.join(dir, "pid");

      yield* Effect.gen(function* () {
        const agents = yield* AgentFixes;

        yield* agents.check;

        const fixing = yield* Effect.forkScoped(agents.fix("claude", () => Effect.void));

        yield* written(pidFile);

        const signIn = Number((yield* fs.readFileString(pidFile)).trim());

        yield* TestClock.adjust("10 minutes");

        expect((yield* Fiber.join(fixing)).ok).toBe(false);
        expect(yield* alive(signIn)).toBe(false);
      }).pipe(
        Effect.provide(fixesFor(dir, fake, { claude: `echo $$ > "${pidFile}"; exec sleep 600` })),
      );
    }),
  );
});
