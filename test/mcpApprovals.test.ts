import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigProvider, Effect, type Layer, Option, type Schema } from "effect";

import { runEdit } from "../src/core/agentRun.ts";
import { AppData } from "../src/core/appData.ts";
import { addFeedback, createItem } from "../src/core/items.ts";
import {
  type McpServersStatus,
  approvedClaudeServers,
  decideMcpServer,
  mcpNotices,
  mcpServersStatus,
} from "../src/core/mcpApprovals.ts";
import type { AgentName } from "../src/core/schema.ts";
import {
  makeFakeAgents,
  makeWorkspace,
  type FakeAgents,
  type TestServices,
  type TestWorkspace,
} from "./support.ts";

let t: TestWorkspace;

let fakes: FakeAgents;

/** Where the user's agents keep their config: Claude Code's `.claude.json` and Codex's `config.toml`. */
let config: string;

let appDir: string;

let env: Layer.Layer<never>;

beforeEach(async () => {
  t = await makeWorkspace("Servers");
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

const failInApp = <A, E>(effect: Effect.Effect<A, E, TestServices>) => inApp(Effect.flip(effect));

const setUpClaude = (record: Schema.JsonObject) =>
  writeFile(join(config, ".claude.json"), JSON.stringify(record));

const stateOf = (status: McpServersStatus, name: string) =>
  status.servers.find((server) => server.name === name)?.state;

/** Turn `name` on or off as the user sees it now. */
const decide = async (agent: AgentName, name: string, on: boolean) => {
  const status = await inApp(mcpServersStatus());
  const server = status.servers.find((one) => one.agent === agent && one.name === name);

  return inApp(decideMcpServer({ agent, name, fingerprint: server?.fingerprint ?? "", on }));
};

const DOCS = { command: "docs-mcp", env: { TOKEN: "t-1" } };

describe("the MCP servers the user set up", () => {
  beforeEach(async () => {
    await fakes.bin("claude", "");
    await setUpClaude({
      mcpServers: { docs: DOCS },
      projects: { [t.root]: { mcpServers: { notes: { command: "notes-mcp" } } } },
    });
  });

  test("are off for runs until the user turns them on, as they saw them", async () => {
    const status = await inApp(mcpServersStatus());

    expect(status.servers.map((server) => [server.name, server.source, server.state])).toEqual([
      ["docs", "user", "new"],
      ["notes", "local", "new"],
    ]);
    expect((await inApp(approvedClaudeServers())).tools).toEqual([]);

    expect(
      (
        await failInApp(
          decideMcpServer({ agent: "claude", name: "docs", fingerprint: "x", on: true }),
        )
      )._tag,
    ).toBe("Conflict");

    expect((await decide("claude", "docs", true)).state).toBe("on");
    expect((await decide("claude", "notes", false)).state).toBe("off");

    const approved = await inApp(approvedClaudeServers());

    expect(Object.keys(approved.servers)).toEqual(["docs"]);
    expect(approved.tools).toEqual(["mcp__docs"]);
  });

  test("keep the user's own once for every workspace, and this folder's by its root", async () => {
    await decide("claude", "docs", true);
    await decide("claude", "notes", false);

    const saved = JSON.parse(await readFile(join(appDir, "mcp-servers.json"), "utf8"));

    expect(saved.user.claude.docs).toEqual({ on: true, fingerprint: expect.any(String) });
    expect(saved.workspaces[t.root].claude.notes).toEqual({
      on: false,
      fingerprint: expect.any(String),
    });
  });

  test("are asked about again when how they start changes, but not for a new key", async () => {
    await decide("claude", "docs", true);
    await decide("claude", "notes", false);

    await setUpClaude({
      mcpServers: { docs: { ...DOCS, env: { TOKEN: "t-2" } } },
      projects: { [t.root]: { mcpServers: { notes: { command: "notes-mcp", args: ["--all"] } } } },
    });

    const rotated = await inApp(mcpServersStatus());

    expect(stateOf(rotated, "docs")).toBe("on");
    // Off stays off, whatever it starts.
    expect(stateOf(rotated, "notes")).toBe("off");

    await setUpClaude({ mcpServers: { docs: { ...DOCS, command: "other-mcp" } } });

    expect(stateOf(await inApp(mcpServersStatus()), "docs")).toBe("changed");
    expect((await inApp(approvedClaudeServers())).tools).toEqual([]);
    expect(await inApp(mcpNotices())).toEqual([
      expect.stringContaining("docs (Claude Code, changed since turned on)"),
    ]);
  });

  test("are told to the agent while they wait for the user", async () => {
    const [notice] = await inApp(mcpNotices());

    expect(notice).toContain("docs (Claude Code, new), notes (Claude Code, new)");

    await decide("claude", "docs", true);
    await decide("claude", "notes", false);

    expect(await inApp(mcpNotices())).toEqual([]);
  });

  test("keep every other record in the file as it was", async () => {
    const store = join(appDir, "mcp-servers.json");
    await writeFile(store, JSON.stringify({ user: { codex: { web: { on: true } } }, later: 1 }));

    await decide("claude", "docs", true);
    const saved = JSON.parse(await readFile(store, "utf8"));

    expect(saved.user.codex).toEqual({ web: { on: true } });
    expect(saved.later).toBe(1);
  });

  test("can't be turned on when they aren't there, or with nowhere to keep it", async () => {
    expect(
      (
        await failInApp(
          decideMcpServer({ agent: "claude", name: "gone", fingerprint: "x", on: true }),
        )
      )._tag,
    ).toBe("NotFound");

    const { fingerprint = "" } = (await inApp(mcpServersStatus())).servers[0] ?? {};

    const error = await t.runWith(
      env,
      Effect.flip(decideMcpServer({ agent: "claude", name: "docs", fingerprint, on: true })),
    );

    expect(error._tag).toBe("InvalidRequest");
  });
});

test("an agent the user doesn't have shows none of its servers", async () => {
  await setUpClaude({ mcpServers: { docs: DOCS } });
  await writeFile(join(config, "config.toml"), '[mcp_servers.web]\nurl = "https://x"\n');

  expect(await inApp(mcpServersStatus())).toEqual({ servers: [], problems: [] });
  expect(await inApp(mcpNotices())).toEqual([]);
});

test("Codex's servers are told to the agent from its config, without starting Codex", async () => {
  const started = join(fakes.calls, "started");
  await fakes.bin("codex", `touch "${started}"\n`);
  await writeFile(join(config, "config.toml"), '[mcp_servers.web]\nurl = "https://x"\n');

  expect(await inApp(mcpNotices())).toEqual([expect.stringContaining("web (Codex, new)")]);
  expect(await Bun.file(started).exists()).toBe(false);
});

/** What the fake agent was given, one argument at a time. */
const given = async () => (await readFile(join(fakes.calls, "args"), "utf8")).split("\0");

const edit = (agent: AgentName) =>
  inApp(
    Effect.gen(function* () {
      const created = yield* createItem({ title: "Clip" });
      const { feedback } = yield* addFeedback(created.id, { body: "Trim it" });

      yield* runEdit(undefined)(
        { itemId: created.id, feedbackId: feedback.id, agent },
        () => Effect.void,
      );
    }),
  );

describe("an edit run", () => {
  test("of Claude loads the servers the user turned on, their secrets off the command line", async () => {
    await fakes.bin(
      "claude",
      `cat > /dev/null
printf '%s\\0' "$@" > "${fakes.calls}/args"
env | grep '^CUTFAC_MCP_SECRET_' > "${fakes.calls}/env"
echo '{"type":"result","subtype":"success","session_id":"s1","result":"Done."}'
`,
    );
    await setUpClaude({ mcpServers: { docs: DOCS, notes: { command: "notes-mcp" } } });
    await decide("claude", "docs", true);

    await edit("claude");

    const argv = await given();
    const mcpConfig = JSON.parse(argv[argv.indexOf("--mcp-config") + 1] ?? "{}");

    expect(mcpConfig.mcpServers).toEqual({
      docs: { command: "docs-mcp", env: { TOKEN: "${CUTFAC_MCP_SECRET_0}" } },
    });
    expect(argv.join(" ")).not.toContain("t-1");
    expect(await readFile(join(fakes.calls, "env"), "utf8")).toBe("CUTFAC_MCP_SECRET_0=t-1\n");

    const allowed = (argv[argv.indexOf("--allowedTools") + 1] ?? "").split(",");

    expect(allowed).toContain("mcp__docs");
    expect(allowed).not.toContain("mcp__notes");
  });

  test("of Codex keeps the servers the user turned on and switches off the rest", async () => {
    const listing = JSON.stringify([
      { name: "docs", enabled: true, transport: { type: "stdio", command: "docs-mcp" } },
      { name: "web", enabled: true, transport: { type: "streamable_http", url: "https://x" } },
    ]);

    await fakes.bin(
      "codex",
      `[ "$1" = mcp ] && { echo '${listing}'; exit 0; }
[ "$1" = exec ] || exit 0
cat > /dev/null
printf '%s\\0' "$@" > "${fakes.calls}/args"
`,
    );
    await decide("codex", "docs", true);

    await edit("codex");

    const argv = await given();

    expect(argv).toContain("mcp_servers.web.enabled=false");
    expect(argv).not.toContain("mcp_servers.docs.enabled=false");
  });
});
