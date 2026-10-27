import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Context, Effect, FileSystem, Layer, Option, Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { refuse } from "../src/core/approval.ts";
import type { Approval, ApprovalAnswer } from "../src/core/approval.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import { Workspace } from "../src/core/workspace.ts";
import {
  askingTrusted,
  fingerprintOf,
  requireTrust,
  trustCreated,
  trustItems,
  trustStatus,
  trustWorkspace,
} from "../src/core/workspaceTrust.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Trust"), fakeAgents));

const SETTINGS = ".claude/settings.json";

const HOOKS = {
  PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }],
};

const trustSetup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const ws = yield* Workspace;
  const appDir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-" });

  yield* ws.mkdir(".claude");

  const inApp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.provideService(effect, AppData, Option.some(appDir));

  const failInApp = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flip(inApp(effect));

  const settle = (settings: Schema.JsonObject) =>
    ws.writeText(SETTINGS, JSON.stringify(settings, null, 2));

  return { ws, appDir, inApp, failInApp, settle };
});

const print = (text: string) => fingerprintOf(trustItems(SETTINGS, text));

describe("the settings a workspace would have Claude Code act on by itself", () => {
  test("are what runs or allows a command, not what only shapes the answer", () => {
    const text = JSON.stringify({
      model: "opus",
      outputStyle: "Explanatory",
      enabledMcpjsonServers: ["x"],
      hooks: HOOKS,
      env: { NODE_OPTIONS: "--require ./x.js" },
      permissions: { allow: ["Bash(*)"], deny: ["Read(./.env)"], ask: [], defaultMode: "plan" },
    });

    expect(trustItems(SETTINGS, text)).toEqual([
      { file: SETTINGS, key: "hooks", value: HOOKS },
      { file: SETTINGS, key: "env", value: { NODE_OPTIONS: "--require ./x.js" } },
      { file: SETTINGS, key: "permissions.allow", value: ["Bash(*)"] },
      { file: SETTINGS, key: "permissions.defaultMode", value: "plan" },
    ]);
  });

  test("leave out what turns nothing on, and keep a file that isn't JSON whole", () => {
    expect(trustItems(SETTINGS, "")).toEqual([]);
    expect(
      trustItems(SETTINGS, '{"hooks": {}, "env": null, "permissions": {"allow": []}}'),
    ).toEqual([]);
    expect(trustItems(SETTINGS, "{ hooks: ")).toEqual([{ file: SETTINGS, value: "{ hooks: " }]);
  });

  it.live("read the same whatever order their keys come in", () =>
    Effect.gen(function* () {
      const first = yield* print('{"env": {"A": "1", "B": "2"}, "hooks": {"Stop": []}}');

      expect(yield* print('{"hooks": {"Stop": []}, "env": {"B": "2", "A": "1"}}')).toBe(first);
      expect(yield* print('{"env": {"A": "1", "B": "3"}, "hooks": {"Stop": []}}')).not.toBe(first);
    }),
  );
});

const Records = Schema.fromJsonString(Schema.Record(Schema.String, Schema.Json));

describe("trusting a workspace", () => {
  it.live("isn't needed while the settings act on nothing", () =>
    Effect.gen(function* () {
      const { inApp, settle } = yield* trustSetup;

      yield* settle({ model: "opus" });

      expect(yield* inApp(trustStatus())).toMatchObject({ needed: false, items: [] });
      yield* inApp(requireTrust("claude"));
    }),
  );

  it.live("holds Claude back until the user trusts the settings they saw", () =>
    Effect.gen(function* () {
      const { inApp, failInApp, settle } = yield* trustSetup;

      yield* settle({ hooks: HOOKS });
      const status = yield* inApp(trustStatus());

      expect(status.needed).toBe(true);
      expect((yield* failInApp(requireTrust("claude")))._tag).toBe("Conflict");
      yield* inApp(requireTrust("codex"));

      expect((yield* failInApp(trustWorkspace("not-these")))._tag).toBe("Conflict");
      expect(yield* inApp(trustWorkspace(status.fingerprint))).toMatchObject({ needed: false });
      expect(yield* inApp(trustStatus())).toMatchObject({ needed: false });
      yield* inApp(requireTrust("claude"));

      yield* settle({ hooks: HOOKS, env: { A: "1" } });
      expect(yield* inApp(trustStatus())).toMatchObject({ needed: true });
    }),
  );

  it.live("keeps other workspaces' records as they were", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { ws, appDir, inApp, settle } = yield* trustSetup;
      const store = join(appDir, "workspaces.json");

      yield* fs.writeFileString(
        store,
        JSON.stringify({ "/elsewhere": { settings: "abc", later: 1 } }),
      );
      yield* settle({ hooks: HOOKS });

      yield* inApp(trustWorkspace((yield* inApp(trustStatus())).fingerprint));

      const saved = yield* Schema.decodeEffect(Records)(yield* fs.readFileString(store));

      expect(saved["/elsewhere"]).toEqual({ settings: "abc", later: 1 });
      expect(saved[ws.root]).toEqual({ settings: expect.any(String) });
    }),
  );

  it.live("leaves a record file it can't read as it was", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const { appDir, inApp, failInApp, settle } = yield* trustSetup;
      const store = join(appDir, "workspaces.json");

      yield* fs.writeFileString(store, "{ not json");
      yield* settle({ hooks: HOOKS });
      const status = yield* inApp(trustStatus());

      expect(status.needed).toBe(true);
      expect((yield* failInApp(trustWorkspace(status.fingerprint)))._tag).toBe("WorkspaceError");
      expect(yield* fs.readFileString(store)).toBe("{ not json");
    }),
  );

  it.live("can't be kept without the app's folder", () =>
    Effect.gen(function* () {
      const { settle } = yield* trustSetup;

      yield* settle({ hooks: HOOKS });
      const status = yield* trustStatus();

      expect((yield* Effect.flip(trustWorkspace(status.fingerprint)))._tag).toBe("InvalidRequest");
    }),
  );

  it.live("comes with a workspace Cutfac made, unless its folder already had such settings", () =>
    Effect.gen(function* () {
      const { inApp, settle } = yield* trustSetup;

      yield* inApp(trustCreated());
      yield* settle({ hooks: HOOKS });

      expect(yield* inApp(trustStatus())).toMatchObject({ needed: false });

      const other = yield* Layer.build(tempWorkspace("Cloned"));
      const cloned = Context.get(other, Workspace);

      yield* cloned.mkdir(".claude");
      yield* cloned.writeText(SETTINGS, JSON.stringify({ hooks: HOOKS }));

      const inCloned = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
        Effect.provide(inApp(effect), other);

      yield* inCloned(trustCreated());
      expect(yield* inCloned(trustStatus())).toMatchObject({ needed: true });
    }),
  );
});

describe("Always allow on the board", () => {
  const LOCAL = ".claude/settings.local.json";

  const ffmpeg: Approval = {
    id: "r1",
    tool: "Bash",
    detail: "ffmpeg -i a.mp4 b.mp4",
    always: true,
    rules: ["Bash(ffmpeg:*)"],
  };

  const alwaysSetup = Effect.gen(function* () {
    const setup = yield* trustSetup;
    const { ws, inApp } = setup;

    const write = (file: string, settings: Schema.JsonObject) =>
      ws.writeText(file, JSON.stringify(settings, null, 2));

    const run = (answer: ApprovalAnswer, after: Readonly<Record<string, Schema.JsonObject>>) =>
      Effect.gen(function* () {
        yield* inApp(
          Effect.gen(function* () {
            const trust = yield* requireTrust("claude");

            yield* askingTrusted(
              trust,
              () => Effect.succeed(answer),
              (ask) =>
                Effect.andThen(
                  ask(ffmpeg),
                  Effect.forEach(
                    Object.entries(after),
                    ([file, settings]) => write(file, settings),
                    { concurrency: "unbounded", discard: true },
                  ),
                ),
            );
          }),
        );

        return !(yield* inApp(trustStatus())).needed;
      });

    return { ...setup, write, run };
  });

  it.live("keeps the workspace trusted for the rule Claude keeps for it", () =>
    Effect.gen(function* () {
      const { run } = yield* alwaysSetup;

      expect(
        yield* run("always", { [LOCAL]: { permissions: { allow: ["Bash(ffmpeg:*)"] } } }),
      ).toBe(true);
    }),
  );

  it.live("adds to the rules the user trusted before", () =>
    Effect.gen(function* () {
      const { inApp, write, run } = yield* alwaysSetup;

      yield* write(SETTINGS, { permissions: { allow: ["Bash(ls:*)"] } });
      yield* inApp(trustWorkspace((yield* inApp(trustStatus())).fingerprint));

      const allow = ["Bash(ls:*)", "Bash(ffmpeg:*)"];

      expect(yield* run("always", { [SETTINGS]: { permissions: { allow } } })).toBe(true);
    }),
  );

  it.live("doesn't cover anything else the run changed in the settings", () =>
    Effect.gen(function* () {
      const { ws, run } = yield* alwaysSetup;
      const rules = (allow: ReadonlyArray<string>) => ({ [LOCAL]: { permissions: { allow } } });

      expect(yield* run("always", rules(["Bash(ffmpeg:*)", "Bash(curl:*)"]))).toBe(false);
      yield* ws.remove(LOCAL);
      expect(yield* run("allow", rules(["Bash(ffmpeg:*)"]))).toBe(false);
      yield* ws.remove(LOCAL);
      expect(
        yield* run("always", { ...rules(["Bash(ffmpeg:*)"]), [SETTINGS]: { hooks: HOOKS } }),
      ).toBe(false);
    }),
  );
});

describe("an edit run in a workspace the user hasn't trusted", () => {
  it.live("fails before Claude starts, saying what to look over", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const fakes = yield* FakeAgentDir;
      const ws = yield* Workspace;
      const started = join(fakes.calls, "started");

      yield* ws.writeText(SETTINGS, JSON.stringify({ hooks: HOOKS }));
      yield* fakes.bin("claude", `touch "${started}"\n`);

      const created = yield* createItem({ title: "Clip" });
      const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });
      const input = { itemId: created.id, feedbackId: feedback.id, agent: "claude" as const };

      yield* runEdit(undefined)(input, () => Effect.void, refuse);

      const run = (yield* getItem(created.id)).doc.feedback[0]?.run;

      expect(run?.status).toBe("failed");
      expect(run?.error).toContain(`hooks in ${SETTINGS}`);
      expect(yield* fs.exists(started)).toBe(false);
    }),
  );
});
