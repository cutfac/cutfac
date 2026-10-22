import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Effect, Option, Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { addFeedback, createItem, getItem } from "../src/core/items.ts";
import {
  fingerprintOf,
  requireTrust,
  trustCreated,
  trustItems,
  trustStatus,
  trustWorkspace,
} from "../src/core/workspaceTrust.ts";
import {
  makeFakeAgents,
  makeWorkspace,
  type FakeAgents,
  type TestServices,
  type TestWorkspace,
} from "./support.ts";

const SETTINGS = ".claude/settings.json";

const HOOKS = {
  PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./check.sh" }] }],
};

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

  test("read the same whatever order their keys come in", async () => {
    const t = await makeWorkspace();
    const print = (text: string) => t.run(fingerprintOf(trustItems(SETTINGS, text)));

    try {
      const first = await print('{"env": {"A": "1", "B": "2"}, "hooks": {"Stop": []}}');

      expect(await print('{"hooks": {"Stop": []}, "env": {"B": "2", "A": "1"}}')).toBe(first);
      expect(await print('{"env": {"A": "1", "B": "3"}, "hooks": {"Stop": []}}')).not.toBe(first);
    } finally {
      await t.remove();
    }
  });
});

describe("trusting a workspace", () => {
  let t: TestWorkspace;
  let appDir: string;

  /** `effect` with the app keeping its records in `appDir`. */
  const withApp = <A, E>(effect: Effect.Effect<A, E, TestServices>) =>
    Effect.provideService(effect, AppData, Option.some(appDir));

  const inApp = <A, E>(effect: Effect.Effect<A, E, TestServices>) => t.run(withApp(effect));

  const failInApp = <A, E>(effect: Effect.Effect<A, E, TestServices>) => t.fail(withApp(effect));

  const settle = (settings: Schema.JsonObject) =>
    writeFile(join(t.root, SETTINGS), JSON.stringify(settings, null, 2));

  beforeEach(async () => {
    t = await makeWorkspace("Trust");
    appDir = await mkdtemp(join(tmpdir(), "cutfac-app-"));
    await mkdir(join(t.root, ".claude"));
  });

  afterEach(async () => {
    await rm(appDir, { recursive: true, force: true });
    await t.remove();
  });

  test("isn't needed while the settings act on nothing", async () => {
    await settle({ model: "opus" });

    expect(await inApp(trustStatus())).toMatchObject({ needed: false, items: [] });
    await inApp(requireTrust("claude"));
  });

  test("holds Claude back until the user trusts the settings they saw", async () => {
    await settle({ hooks: HOOKS });
    const status = await inApp(trustStatus());

    expect(status.needed).toBe(true);
    expect((await failInApp(requireTrust("claude")))._tag).toBe("Conflict");
    // Codex leaves a folder's own settings off by itself.
    await inApp(requireTrust("codex"));

    expect((await failInApp(trustWorkspace("not-these")))._tag).toBe("Conflict");
    expect(await inApp(trustWorkspace(status.fingerprint))).toMatchObject({ needed: false });
    expect(await inApp(trustStatus())).toMatchObject({ needed: false });
    await inApp(requireTrust("claude"));

    // Settings added since are not trusted.
    await settle({ hooks: HOOKS, env: { A: "1" } });
    expect(await inApp(trustStatus())).toMatchObject({ needed: true });
  });

  test("keeps other workspaces' records as they were", async () => {
    const store = join(appDir, "workspaces.json");
    await writeFile(store, JSON.stringify({ "/elsewhere": { settings: "abc", later: 1 } }));
    await settle({ hooks: HOOKS });

    await inApp(trustWorkspace((await inApp(trustStatus())).fingerprint));

    const saved = JSON.parse(await readFile(store, "utf8"));

    expect(saved["/elsewhere"]).toEqual({ settings: "abc", later: 1 });
    expect(saved[t.root]).toEqual({ settings: expect.any(String) });
  });

  test("leaves a record file it can't read as it was", async () => {
    const store = join(appDir, "workspaces.json");
    await writeFile(store, "{ not json");
    await settle({ hooks: HOOKS });
    const status = await inApp(trustStatus());

    expect(status.needed).toBe(true);
    expect((await failInApp(trustWorkspace(status.fingerprint)))._tag).toBe("WorkspaceError");
    expect(await readFile(store, "utf8")).toBe("{ not json");
  });

  test("can't be kept without the app's folder", async () => {
    await settle({ hooks: HOOKS });
    const status = await t.run(trustStatus());

    expect((await t.fail(trustWorkspace(status.fingerprint)))._tag).toBe("InvalidRequest");
  });

  test("comes with a workspace Cutfac made, unless its folder already had such settings", async () => {
    await inApp(trustCreated());
    await settle({ hooks: HOOKS });

    expect(await inApp(trustStatus())).toMatchObject({ needed: false });

    const other = await makeWorkspace("Cloned");

    try {
      await mkdir(join(other.root, ".claude"));
      await writeFile(join(other.root, SETTINGS), JSON.stringify({ hooks: HOOKS }));

      await other.run(withApp(trustCreated()));
      expect(await other.run(withApp(trustStatus()))).toMatchObject({ needed: true });
    } finally {
      await other.remove();
    }
  });
});

describe("an edit run in a workspace the user hasn't trusted", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Untrusted");
    fakes = await makeFakeAgents();
    await mkdir(join(t.root, ".claude"));
    await writeFile(join(t.root, SETTINGS), JSON.stringify({ hooks: HOOKS }));
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("fails before Claude starts, saying what to look over", async () => {
    const started = join(fakes.calls, "started");
    await fakes.bin("claude", `touch "${started}"\n`);

    const item = await t.runWith(
      fakes.layer,
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });
        const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });
        const input = { itemId: created.id, feedbackId: feedback.id, agent: "claude" as const };

        yield* runEdit(undefined)(input, () => Effect.void);

        return yield* getItem(created.id);
      }),
    );

    const run = item.doc.feedback[0]?.run;

    expect(run?.status).toBe("failed");
    expect(run?.error).toContain(`hooks in ${SETTINGS}`);
    expect(await Bun.file(started).exists()).toBe(false);
  });
});
