import { describe, expect } from "bun:test";

// Each check builds the log for one process, as that process provides it when it starts.
// @effect-diagnostics strictEffectProvide:off
import { BunServices } from "@effect/platform-bun";
import { ConfigProvider, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { TestClock } from "effect/testing";

import { LogDir, logDir, logToFile } from "../src/core/logFile.ts";
import { testEffect } from "./effect.ts";

const it = testEffect(BunServices.layer);

const NOW = Date.parse("2026-10-28T09:00:00Z");

const HOME = "/Users/someone";

/** A log folder of its own, removed after the test. */
const folder = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-logs-" });
});

/** An environment of just `vars`, so this machine's own never leaks in. */
const envOf = (vars: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env: vars }));

/** Runs `effect` with the server's log in `dir`, then closes it, which writes what is left. */
const logged = <A, E>(dir: string, effect: Effect.Effect<A, E>) =>
  Effect.scoped(
    Effect.provide(
      effect,
      logToFile("server").pipe(
        Layer.provide([Layer.succeed(LogDir, Option.some(dir)), envOf({ HOME })]),
      ),
    ),
  );

const LogLine = Schema.fromJsonString(
  Schema.Struct({
    level: Schema.String,
    message: Schema.Unknown,
    cause: Schema.optional(Schema.String),
  }),
);

/** The lines in today's server log. */
const lines = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const text = yield* fs.readFileString(path.join(dir, "server-2026-10-28.log"));

  return yield* Effect.forEach(
    text.split("\n").filter((line) => line !== ""),
    (line) => Schema.decodeEffect(LogLine)(line),
  );
});

/** The log folder a process run from source finds in `vars`. */
const folderWith = (vars: Record<string, string>) =>
  Effect.provide(LogDir, logDir.pipe(Layer.provide(envOf(vars))));

/** Lets the log's own fiber write what ended. */
const settle = Effect.forEach(Array.from({ length: 5 }), () => Effect.yieldNow);

describe("the desktop app's log", () => {
  it.effect("keeps logs as JSON lines, with the home folder as ~", () =>
    Effect.gen(function* () {
      const dir = yield* folder;

      yield* TestClock.setTime(NOW);
      yield* logged(dir, Effect.logWarning(`Could not read ${HOME}/work/cut.mp4`));

      expect(yield* lines(dir)).toEqual([
        { level: "WARN", message: "Could not read ~/work/cut.mp4" },
      ]);
    }),
  );

  it.effect("keeps a line for an operation that failed, took a second, or answered an agent", () =>
    Effect.gen(function* () {
      const dir = yield* folder;
      const quick = Effect.fn("quick")(() => Effect.void);
      const slow = Effect.fn("slow")(() => TestClock.adjust("2 seconds"));
      const broken = Effect.fn("broken")(() => Effect.fail("nope"));
      const outer = Effect.fn("outer")(() => slow());

      yield* TestClock.setTime(NOW);
      yield* logged(
        dir,
        Effect.gen(function* () {
          yield* quick();
          yield* outer();
          yield* Effect.ignore(broken());
          yield* Effect.withSpan(Effect.void, "McpServer.tools/call");
          yield* settle;
        }),
      );

      const kept = yield* lines(dir);

      expect(kept.map(({ level, message }) => [level, message])).toEqual([
        ["INFO", "outer took 2000ms"],
        ["ERROR", "broken took 0ms and failed"],
        ["INFO", "McpServer.tools/call took 0ms"],
      ]);
      expect(kept[1]?.cause).toContain("nope");
    }),
  );

  it.effect("removes days past a week, and leaves other files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* folder;
      const names = ["app-2026-10-20.log", "mcp-2026-10-21.log", "app-2026-10-27.log", "notes.txt"];

      yield* Effect.forEach(names, (name) => fs.writeFileString(path.join(dir, name), "x\n"));
      yield* TestClock.setTime(NOW);
      yield* logged(dir, Effect.void);

      expect((yield* fs.readDirectory(dir)).toSorted()).toEqual([
        "app-2026-10-27.log",
        "mcp-2026-10-21.log",
        "notes.txt",
        "server-2026-10-28.log",
      ]);
    }),
  );

  it.effect("removes the oldest days once the logs grow past 50 MB", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* folder;
      const MB = 1024 * 1024;

      // Sparse files: the size counts without writing it.
      yield* fs.writeFileString(path.join(dir, "app-2026-10-26.log"), "");
      yield* fs.truncate(path.join(dir, "app-2026-10-26.log"), 30 * MB);
      yield* fs.writeFileString(path.join(dir, "app-2026-10-27.log"), "");
      yield* fs.truncate(path.join(dir, "app-2026-10-27.log"), 30 * MB);
      yield* TestClock.setTime(NOW);
      yield* logged(dir, Effect.void);

      expect((yield* fs.readDirectory(dir)).toSorted()).toEqual([
        "app-2026-10-27.log",
        "server-2026-10-28.log",
      ]);
    }),
  );

  it.effect("writes nothing for the open-source CLI, which has no log folder", () =>
    Effect.gen(function* () {
      const dir = yield* folder;
      const fs = yield* FileSystem.FileSystem;

      yield* Effect.scoped(
        Effect.provide(Effect.logWarning("only on stderr"), logToFile("server")),
      );

      expect(yield* fs.readDirectory(dir)).toEqual([]);
    }),
  );

  it.effect("takes the folder from CUTFAC_LOG_DIR when run from source", () =>
    Effect.gen(function* () {
      expect(yield* folderWith({ CUTFAC_LOG_DIR: "/tmp/cutfac-logs" })).toEqual(
        Option.some("/tmp/cutfac-logs"),
      );
      expect(yield* folderWith({ HOME })).toEqual(Option.none());
    }),
  );
});
