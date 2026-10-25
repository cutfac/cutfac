import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, type Layer, Option } from "effect";

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
import {
  codexAppServer,
  codexParams,
  codexReceived,
  makeFakeAgents,
  makeWorkspace,
  type FakeAgents,
  type TestServices,
  type TestWorkspace,
} from "./support.ts";

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

let t: TestWorkspace;

let fakes: FakeAgents;

/** Where the user's agents keep their config: Claude Code's `settings.json` and Codex's `config.toml`. */
let config: string;

let appDir: string;

let env: Layer.Layer<never>;

beforeEach(async () => {
  t = await makeWorkspace("Permissions");
  fakes = await makeFakeAgents();
  config = await mkdtemp(join(tmpdir(), "cutfac-agent-config-"));
  appDir = await mkdtemp(join(tmpdir(), "cutfac-app-"));

  env = ConfigProvider.layer(
    ConfigProvider.fromEnv({
      env: { PATH: join(fakes.dir, "bin"), CLAUDE_CONFIG_DIR: config, CODEX_HOME: config },
    }),
  );
});

afterEach(async () => {
  await rm(appDir, { recursive: true, force: true });
  await rm(config, { recursive: true, force: true });
  await fakes.remove();
  await t.remove();
});

/** `effect` with the user's agent config in `config` and the app keeping its records in `appDir`. */
const inApp = <A, E>(effect: Effect.Effect<A, E, TestServices>) =>
  t.runWith(env, Effect.provideService(effect, AppData, Option.some(appDir)));

const claudeMode = (defaultMode: string) =>
  JSON.stringify({ permissions: { defaultMode }, model: "opus" });

describe("the user's choice", () => {
  test("follows their own settings until they choose, as the board shows them", async () => {
    await writeFile(join(config, "settings.json"), claudeMode("auto"));
    await writeFile(join(config, "config.toml"), 'sandbox_mode = "danger-full-access"\n');

    expect(await inApp(agentPermissions())).toEqual([
      { agent: "claude", mode: "follow", follows: "auto", setting: "auto" },
      { agent: "codex", mode: "follow", follows: "full", setting: "danger-full-access" },
    ]);
  });

  test("reads the workspace's Claude Code settings over the user's", async () => {
    await writeFile(join(config, "settings.json"), claudeMode("auto"));
    await mkdir(join(t.root, ".claude"), { recursive: true });
    await writeFile(join(t.root, ".claude", "settings.json"), claudeMode("plan"));

    const [claude] = await inApp(agentPermissions());

    expect(claude).toMatchObject({ follows: "limited", setting: "plan" });
  });

  test("is kept in the app's own folder, beside what else it keeps for the agent", async () => {
    await writeFile(join(appDir, "agents.json"), JSON.stringify({ codex: { seen: 1 } }));

    expect(await inApp(setAgentPermissions({ agent: "codex", mode: "full" }))).toMatchObject({
      agent: "codex",
      mode: "full",
    });
    expect(JSON.parse(await readFile(join(appDir, "agents.json"), "utf8"))).toEqual({
      codex: { seen: 1, permissions: "full" },
    });

    const views = await inApp(agentPermissions());

    expect(views.map((view) => view.mode)).toEqual(["follow", "full"]);
  });

  test("falls back to following the user's settings when the record doesn't read", async () => {
    await writeFile(
      join(appDir, "agents.json"),
      JSON.stringify({ claude: { permissions: "all" } }),
    );

    const [claude] = await inApp(agentPermissions());

    expect(claude?.mode).toBe("follow");
  });
});

/** What the fake Codex was asked to start the thread with. */
const threadParams = async () => codexParams(await codexReceived(fakes.calls), "thread/start");

const given = async () => (await readFile(join(fakes.calls, "args"), "utf8")).split("\0");

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

/** The value after `flag` in `argv`. */
const after = (argv: ReadonlyArray<string>, flag: string) => argv[argv.indexOf(flag) + 1];

describe("an edit run", () => {
  beforeEach(async () => {
    await fakes.bin(
      "claude",
      `head -n 1 >/dev/null
printf '%s\\0' "$@" > "${fakes.calls}/args"
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
    );
    await fakes.bin("codex", codexAppServer(fakes.calls));
  });

  test("of Claude leaves the user's mode to Claude, which asks the board what it would ask", async () => {
    await edit("claude");

    const argv = await given();

    expect(argv).not.toContain("--permission-mode");
    expect(after(argv, "--permission-prompt-tool")).toBe("stdio");
  });

  test("of Claude takes the mode the user chose", async () => {
    await writeFile(join(config, "settings.json"), claudeMode("plan"));
    await inApp(setAgentPermissions({ agent: "claude", mode: "full" }));

    await edit("claude");

    expect(after(await given(), "--permission-mode")).toBe("bypassPermissions");
  });

  test("of Claude allows only Cutfac's own tools, whatever an earlier cutfac.yaml lists", async () => {
    await writeFile(
      join(t.root, "cutfac.yaml"),
      "name: Permissions\nagent:\n  claudeAllowedTools: [Bash(uv:*)]\n",
    );

    await edit("claude");

    const allowed = after(await given(), "--allowedTools")?.split(",") ?? [];

    expect(allowed).not.toContain("Bash(uv:*)");

    for (const tool of allowed) expect(tool).toStartWith("mcp__cutfac__");
  });

  test("of Codex leaves the user's own approvals to Codex, with the workspace writable", async () => {
    await writeFile(
      join(config, "config.toml"),
      'approval_policy = "on-request"\napprovals_reviewer = "guardian_subagent"\n',
    );

    await edit("codex");

    expect(await threadParams()).toEqual({ sandbox: "workspace-write" });
  });

  test("of Codex takes the mode the user chose", async () => {
    await inApp(setAgentPermissions({ agent: "codex", mode: "full" }));

    await edit("codex");

    expect(await threadParams()).toEqual({
      sandbox: "danger-full-access",
      approvalPolicy: "never",
    });
  });
});
