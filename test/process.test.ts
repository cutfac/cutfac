import { describe, expect } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { refuse } from "../src/core/approval.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
import { run } from "../src/core/process.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const DAEMON = "CODEX_APP_SERVER_USE_LOCAL_DAEMON";

const it = testEffect(Layer.merge(tempWorkspace("Daemon"), fakeAgents));

/** What the desktop app hands every app the user opens, until the test ends. */
const withDaemonSetting = Effect.acquireRelease(
  Effect.sync(() => {
    const before = process.env[DAEMON];

    process.env[DAEMON] = "1";

    return before;
  }),
  (before) =>
    Effect.sync(() => {
      if (before === undefined) Reflect.deleteProperty(process.env, DAEMON);
      else process.env[DAEMON] = before;
    }),
);

/** A fake Codex that notes the setting it saw with each command, and lists no servers of its own. */
const codexNotingTheSetting = Effect.gen(function* () {
  const fakes = yield* FakeAgentDir;
  const fs = yield* FileSystem.FileSystem;
  const seen = join(fakes.calls, "seen");

  yield* withDaemonSetting;
  yield* fakes.bin(
    "codex",
    `echo "$1 \${${DAEMON}-unset}" >> "${seen}"\n[ "$1" = mcp ] && echo "[]"\nexit 0\n`,
  );

  const lines = Effect.map(fs.readFileString(seen), (text) => text.trim().split("\n")).pipe(
    Effect.orDie,
  );

  return { fakes, lines };
});

describe("a command Cutfac runs on a Mac where the Codex desktop app is set up", () => {
  it.live("doesn't pass on the desktop app's daemon setting, which stops `codex mcp`", () =>
    Effect.gen(function* () {
      const { fakes, lines } = yield* codexNotingTheSetting;

      yield* run(join(fakes.dir, "bin", "codex"), ["mcp"]);

      expect(yield* lines).toEqual(["mcp unset"]);
    }),
  );

  it.live("leaves it out of an edit run's Codex too", () =>
    Effect.gen(function* () {
      const { lines } = yield* codexNotingTheSetting;
      const created = yield* createItem({ title: "Clip" });
      const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });

      yield* runEdit(undefined)(
        { itemId: created.id, feedbackId: feedback.id, agent: "codex" },
        () => Effect.void,
        refuse,
      );

      const calls = yield* lines;

      expect(calls).toContain("app-server unset");
      expect(calls.every((line) => line.endsWith(" unset"))).toBe(true);
    }),
  );
});
