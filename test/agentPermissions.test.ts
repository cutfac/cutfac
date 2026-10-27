import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Effect, FileSystem, Layer, Option } from "effect";

import {
  agentPermissions,
  claudeAccess,
  claudePermissionFlags,
  codexAccess,
  codexPermissions,
  codexPermissionSettings,
  setAgentPermissions,
} from "../src/core/agentPermissions.ts";
import { runEdit } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { refuse } from "../src/core/approval.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
import type { AgentName } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import {
  codexAppServer,
  codexParams,
  codexReceived,
  FakeAgentDir,
  fakeAgents,
  tempWorkspace,
} from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Permissions"), fakeAgents));

test("Claude's flags leave the user's mode to Claude, or set one of Cutfac's over it", () => {
  expect(claudePermissionFlags("follow")).toEqual([]);
  expect(claudePermissionFlags("edit")).toEqual(["--permission-mode", "acceptEdits"]);
  expect(claudePermissionFlags("auto")).toEqual(["--permission-mode", "auto"]);
  expect(claudePermissionFlags("full")).toEqual(["--permission-mode", "bypassPermissions"]);
});

describe("Codex's permissions", () => {
  test("follow the user's, with the workspace writable where they set no sandbox", () => {
    expect(codexPermissions("follow", {})).toEqual({ sandbox: "workspace-write" });
    expect(codexPermissions("follow", { approval: "never" })).toEqual({
      sandbox: "workspace-write",
    });
    expect(codexPermissions("follow", { sandbox: "read-only", reviewer: "user" })).toEqual({});
  });

  test("set Cutfac's own modes over the user's", () => {
    const user = { sandbox: "read-only", approval: "never", reviewer: "auto_review" };

    expect(codexPermissions("edit", user)).toEqual({
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
    });
    expect(codexPermissions("auto", user)).toEqual({
      sandbox: "workspace-write",
      approvalPolicy: "on-request",
      approvalsReviewer: "auto_review",
    });
    expect(codexPermissions("full", user)).toEqual({
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
  });
});

test("following the user's settings comes to what they let a run do", () => {
  expect(claudeAccess({})).toBe("asks");
  expect(claudeAccess({ defaultMode: "default" })).toBe("asks");
  expect(claudeAccess({ defaultMode: "acceptEdits" })).toBe("edit");
  expect(claudeAccess({ defaultMode: "auto" })).toBe("auto");
  expect(claudeAccess({ defaultMode: "bypassPermissions" })).toBe("full");
  expect(claudeAccess({ defaultMode: "plan" })).toBe("limited");
  expect(claudeAccess({ defaultMode: "dontAsk" })).toBe("limited");

  expect(codexAccess({})).toBe("edit");
  expect(codexAccess({ sandbox: "danger-full-access" })).toBe("full");
  expect(codexAccess({ approval: "untrusted" })).toBe("asks");
  expect(codexAccess({ sandbox: "read-only" })).toBe("asks");
  expect(codexAccess({ sandbox: "read-only", reviewer: "auto_review" })).toBe("auto");
  expect(codexAccess({ approval: "on-request", reviewer: "guardian_subagent" })).toBe("auto");
  expect(codexAccess({ approval: "never", reviewer: "guardian_subagent" })).toBe("unasked");
  expect(codexAccess({ sandbox: "read-only", approval: "never" })).toBe("limited");
});

describe("Codex's own settings", () => {
  test("come from its config.toml, its profile's over its own", () => {
    const toml = `
sandbox_mode = "workspace-write"
approval_policy = "on-request"
approvals_reviewer = "guardian_subagent"
profile = "wide"

[profiles.wide]
sandbox_mode = "danger-full-access"
`;

    expect(codexPermissionSettings(toml)).toEqual({
      sandbox: "danger-full-access",
      approval: "on-request",
      reviewer: "guardian_subagent",
    });
  });

  test("keep only an approval policy named as text", () => {
    const toml = `
approvals_reviewer = "auto_review"

[approval_policy.granular]
sandbox_approval = true
`;

    expect(codexPermissionSettings(toml)).toEqual({
      sandbox: undefined,
      approval: undefined,
      reviewer: "auto_review",
    });
  });

  test("are none when the file doesn't read", () => {
    expect(codexPermissionSettings('sandbox_mode = "')).toEqual({});
    expect(codexPermissionSettings("sandbox_mode = 3")).toEqual({});
  });
});

const permissionsSetup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const ws = yield* Workspace;
  const fakes = yield* FakeAgentDir;
  const config = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-agent-config-" });
  const appDir = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-" });

  const env = ConfigProvider.fromEnv({
    env: { PATH: join(fakes.dir, "bin"), CLAUDE_CONFIG_DIR: config, CODEX_HOME: config },
  });

  const inApp = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.provideService(AppData, Option.some(appDir)),
      Effect.provideService(ConfigProvider.ConfigProvider, env),
    );

  return { fs, ws, fakes, config, appDir, inApp };
});

const claudeMode = (defaultMode: string) =>
  JSON.stringify({ permissions: { defaultMode }, model: "opus" });

describe("the user's choice", () => {
  it.live("follows their own settings until they choose, as the board shows them", () =>
    Effect.gen(function* () {
      const { fs, config, inApp } = yield* permissionsSetup;

      yield* fs.writeFileString(join(config, "settings.json"), claudeMode("auto"));
      yield* fs.writeFileString(
        join(config, "config.toml"),
        'sandbox_mode = "danger-full-access"\n',
      );

      expect(yield* inApp(agentPermissions())).toEqual([
        { agent: "claude", mode: "follow", follows: "auto", setting: "auto" },
        { agent: "codex", mode: "follow", follows: "full", setting: "danger-full-access" },
      ]);
    }),
  );

  it.live("reads the workspace's Claude Code settings over the user's", () =>
    Effect.gen(function* () {
      const { fs, ws, config, inApp } = yield* permissionsSetup;

      yield* fs.writeFileString(join(config, "settings.json"), claudeMode("auto"));
      yield* ws.writeText(".claude/settings.json", claudeMode("plan"));

      const [claude] = yield* inApp(agentPermissions());

      expect(claude).toMatchObject({ follows: "limited", setting: "plan" });
    }),
  );

  it.live("is kept in the app's own folder, beside what else it keeps for the agent", () =>
    Effect.gen(function* () {
      const { fs, appDir, inApp } = yield* permissionsSetup;

      yield* fs.writeFileString(
        join(appDir, "agents.json"),
        JSON.stringify({ codex: { seen: 1 } }),
      );

      expect(yield* inApp(setAgentPermissions({ agent: "codex", mode: "full" }))).toMatchObject({
        agent: "codex",
        mode: "full",
      });
      expect(JSON.parse(yield* fs.readFileString(join(appDir, "agents.json")))).toEqual({
        codex: { seen: 1, permissions: "full" },
      });

      const views = yield* inApp(agentPermissions());

      expect(views.map((view) => view.mode)).toEqual(["follow", "full"]);
    }),
  );

  it.live("falls back to following the user's settings when the record doesn't read", () =>
    Effect.gen(function* () {
      const { fs, appDir, inApp } = yield* permissionsSetup;

      yield* fs.writeFileString(
        join(appDir, "agents.json"),
        JSON.stringify({ claude: { permissions: "all" } }),
      );

      const [claude] = yield* inApp(agentPermissions());

      expect(claude?.mode).toBe("follow");
    }),
  );
});

/** The value after `flag` in `argv`. */
const after = (argv: ReadonlyArray<string>, flag: string) => argv[argv.indexOf(flag) + 1];

const editSetup = Effect.gen(function* () {
  const setup = yield* permissionsSetup;
  const { fs, fakes, inApp } = setup;

  yield* fakes.bin(
    "claude",
    `head -n 1 >/dev/null
printf '%s\\0' "$@" > "${fakes.calls}/args"
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
  );
  yield* fakes.bin("codex", codexAppServer(fakes.calls));

  const edit = (agent: AgentName) =>
    inApp(
      Effect.gen(function* () {
        const created = yield* createItem({ title: "Clip" });
        const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });

        yield* runEdit(undefined)(
          { itemId: created.id, feedbackId: feedback.id, agent },
          () => Effect.void,
          refuse,
        );
      }),
    );

  const threadParams = Effect.map(codexReceived(fakes.calls), (received) =>
    codexParams(received, "thread/start"),
  );

  const given = Effect.map(Effect.orDie(fs.readFileString(join(fakes.calls, "args"))), (args) =>
    args.split("\0"),
  );

  return { ...setup, edit, threadParams, given };
});

describe("an edit run", () => {
  it.live(
    "of Claude leaves the user's mode to Claude, which asks the board what it would ask",
    () =>
      Effect.gen(function* () {
        const { edit, given } = yield* editSetup;

        yield* edit("claude");

        const argv = yield* given;

        expect(argv).not.toContain("--permission-mode");
        expect(after(argv, "--permission-prompt-tool")).toBe("stdio");
      }),
  );

  it.live("of Claude takes the mode the user chose", () =>
    Effect.gen(function* () {
      const { fs, config, inApp, edit, given } = yield* editSetup;

      yield* fs.writeFileString(join(config, "settings.json"), claudeMode("plan"));
      yield* inApp(setAgentPermissions({ agent: "claude", mode: "full" }));

      yield* edit("claude");

      expect(after(yield* given, "--permission-mode")).toBe("bypassPermissions");
    }),
  );

  it.live("of Claude allows only Cutfac's own tools, whatever an earlier cutfac.yaml lists", () =>
    Effect.gen(function* () {
      const { ws, edit, given } = yield* editSetup;

      yield* ws.writeText(
        "cutfac.yaml",
        "name: Permissions\nagent:\n  claudeAllowedTools: [Bash(uv:*)]\n",
      );

      yield* edit("claude");

      const allowed = after(yield* given, "--allowedTools")?.split(",") ?? [];

      expect(allowed).not.toContain("Bash(uv:*)");

      for (const tool of allowed) expect(tool).toStartWith("mcp__cutfac__");
    }),
  );

  it.live("of Codex leaves the user's own approvals to Codex, with the workspace writable", () =>
    Effect.gen(function* () {
      const { fs, config, edit, threadParams } = yield* editSetup;

      yield* fs.writeFileString(
        join(config, "config.toml"),
        'approval_policy = "on-request"\napprovals_reviewer = "guardian_subagent"\n',
      );

      yield* edit("codex");

      expect(yield* threadParams).toEqual({ sandbox: "workspace-write" });
    }),
  );

  it.live("of Codex takes the mode the user chose", () =>
    Effect.gen(function* () {
      const { inApp, edit, threadParams } = yield* editSetup;

      yield* inApp(setAgentPermissions({ agent: "codex", mode: "full" }));

      yield* edit("codex");

      expect(yield* threadParams).toEqual({
        sandbox: "danger-full-access",
        approvalPolicy: "never",
      });
    }),
  );
});
