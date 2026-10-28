import { describe, expect } from "bun:test";
import path from "node:path";

import { Effect, Fiber, FileSystem, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { platform } from "../electron/platform.ts";
import { eventually, testEffect } from "./effect.ts";

const it = testEffect(platform);

const FIXTURE = path.join(import.meta.dir, "fixtures", "script.ts");

const startScript = Effect.fnUntraced(function* (mode: string) {
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const dir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-script-" });
  const started = path.join(dir, "started");
  const cleaned = path.join(dir, "cleaned");

  const handle = yield* spawner.spawn(
    ChildProcess.make(process.execPath, [FIXTURE, mode, started, cleaned]),
  );

  const reading = yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.mkString,
    Effect.forkScoped,
  );

  const exitCode = Effect.match(handle.exitCode, {
    onSuccess: Number,
    onFailure: () => "killed by a signal",
  });

  return { handle, started, cleaned, exitCode, stderr: Fiber.join(reading) };
});

describe("a script's entry", () => {
  it.live("runs the cleanup of a script stopped with Ctrl+C, and exits 130", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const script = yield* startScript("wait");

      yield* eventually(fs.exists(script.started));
      yield* script.handle.kill({ killSignal: "SIGINT", forceKillAfter: "5 seconds" });

      expect(yield* fs.exists(script.cleaned)).toBe(true);
      expect(yield* script.exitCode).toBe(130);
    }),
  );

  it.live("exits with the code the script ends with", () =>
    Effect.gen(function* () {
      expect(yield* (yield* startScript("code")).exitCode).toBe(3);
    }),
  );

  it.live("prints a failure under the script's name and exits 1", () =>
    Effect.gen(function* () {
      const script = yield* startScript("fail");

      expect(yield* script.exitCode).toBe(1);
      expect(yield* script.stderr).toContain("[fixture] it broke");
    }),
  );
});
