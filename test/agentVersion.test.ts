import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Effect } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { converse } from "../src/core/agentRun.ts";
import { agentStatus } from "../src/core/agents.ts";
import {
  type AgentRelease,
  MIN_AGENT_VERSION,
  agentVersionNotices,
  isOlderVersion,
  outdatedAgent,
  outdatedNotice,
  parseAgentVersion,
  unreadableOutputMessage,
  updateCommand,
} from "../src/core/agentVersion.ts";
import type { AgentName } from "../src/core/schema.ts";
import { makeFakeAgents, makeWorkspace, type FakeAgents, type TestWorkspace } from "./support.ts";

describe("parseAgentVersion", () => {
  test("reads what claude and codex print", () => {
    expect(parseAgentVersion("2.1.301 (Claude Code)\n")).toBe("2.1.301");
    expect(parseAgentVersion("codex-cli 0.163.0\n")).toBe("0.163.0");
  });

  test("keeps the release of a prerelease or a prefixed number", () => {
    expect(parseAgentVersion("codex-cli 0.164.0-alpha.2")).toBe("0.164.0");
    expect(parseAgentVersion("v1.2.3")).toBe("1.2.3");
  });

  test("says nothing for output that holds no release number", () => {
    expect(parseAgentVersion("")).toBeUndefined();
    expect(parseAgentVersion("command not found")).toBeUndefined();
    expect(parseAgentVersion("1.2")).toBeUndefined();
    expect(parseAgentVersion("listening on 10.0.0.1")).toBeUndefined();
  });

  test("the minimums are releases it can read", () => {
    for (const minimum of Object.values(MIN_AGENT_VERSION)) {
      expect(parseAgentVersion(minimum)).toBe(minimum);
    }
  });
});

/** Where each CLI's own installer puts it. */
const NATIVE: Readonly<Record<AgentName, string>> = {
  claude: "/Users/ada/.local/share/claude/versions/2.1.1",
  codex: "/Users/ada/.codex/packages/standalone/releases/0.125.0-aarch64-apple-darwin/bin/codex",
};

const release = (agent: AgentName, version: string): AgentRelease => ({
  version,
  installedAt: NATIVE[agent],
});

describe("comparing versions", () => {
  test("compares each part as a number", () => {
    expect(isOlderVersion("2.1.9", "2.1.257")).toBe(true);
    expect(isOlderVersion("2.1.257", "2.1.257")).toBe(false);
    expect(isOlderVersion("2.1.258", "2.1.257")).toBe(false);
    expect(isOlderVersion("2.10.0", "2.9.9")).toBe(false);
    expect(isOlderVersion("0.99.0", "0.128.0")).toBe(true);
    expect(isOlderVersion("10.0.0", "9.0.0")).toBe(false);
  });

  test("only an older release is outdated, and it comes with how to update", () => {
    expect(outdatedAgent("claude", release("claude", "2.1.1"))).toEqual({
      minimum: MIN_AGENT_VERSION.claude,
      update: "claude update",
    });

    expect(outdatedAgent("codex", release("codex", "0.1.0"))?.minimum).toBe(
      MIN_AGENT_VERSION.codex,
    );
    expect(outdatedAgent("claude", release("claude", MIN_AGENT_VERSION.claude))).toBeUndefined();
    expect(outdatedAgent("claude", release("claude", "99.0.0"))).toBeUndefined();
  });

  test("an unknown version is never outdated", () => {
    expect(outdatedAgent("claude", undefined)).toBeUndefined();
    expect(outdatedAgent("codex", undefined)).toBeUndefined();
  });

  test("the notice names the agent, both versions and the command", () => {
    const outdated = outdatedAgent("claude", release("claude", "2.1.1"));

    if (outdated === undefined) throw new Error("2.1.1 should be outdated");
    const notice = outdatedNotice("claude", "2.1.1", outdated);

    expect(notice).toContain("Claude Code 2.1.1");
    expect(notice).toContain(MIN_AGENT_VERSION.claude);
    expect(notice).toContain("`claude update`");
  });
});

/** The update command for `agent` at `version`, installed at `installedAt`. */
const at = (agent: AgentName, version: string, installedAt: string) =>
  updateCommand(agent, { version, installedAt });

describe("updateCommand", () => {
  test("Claude Code updates itself", () => {
    expect(updateCommand("claude", release("claude", "2.1.1"))).toBe("claude update");
  });

  test("Codex updates itself from the first release with `codex update`", () => {
    expect(
      at("codex", "0.126.0", "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"),
    ).toBe("codex update");
    expect(at("codex", "0.127.3", NATIVE.codex)).toBe("codex update");
  });

  test("an older Codex is updated through whatever installed it", () => {
    expect(updateCommand("codex", release("codex", "0.125.0"))).toBe(
      "curl -fsSL https://chatgpt.com/codex/install.sh | sh",
    );
    expect(
      at(
        "codex",
        "0.125.0",
        "/Users/ada/.bun/install/global/node_modules/@openai/codex/bin/codex.js",
      ),
    ).toBe("bun install -g @openai/codex@latest");
    // npm under Homebrew's prefix is still npm.
    expect(
      at("codex", "0.125.0", "/opt/homebrew/lib/node_modules/@openai/codex/bin/codex.js"),
    ).toBe("npm install -g @openai/codex@latest");
  });

  test("a Homebrew install is upgraded as the cask or formula it came from", () => {
    expect(at("claude", "2.1.1", "/opt/homebrew/Caskroom/claude-code/2.1.1/claude")).toBe(
      "brew upgrade --cask claude-code",
    );
    expect(
      at("codex", "0.127.0", "/opt/homebrew/Caskroom/codex/0.127.0/codex-aarch64-apple-darwin"),
    ).toBe("brew upgrade --cask codex");
    expect(at("codex", "0.125.0", "/usr/local/Cellar/codex/0.125.0/bin/codex")).toBe(
      "brew upgrade codex",
    );
  });
});

describe("unreadableOutputMessage", () => {
  test("names the agent and its version", () => {
    expect(unreadableOutputMessage("claude", release("claude", "99.0.0"))).toBe(
      "Couldn't read claude 99.0.0's output; Cutfac may need an update.",
    );
  });

  test("leaves the version out when it is not known", () => {
    expect(unreadableOutputMessage("codex", undefined)).toBe(
      "Couldn't read codex's output; Cutfac may need an update.",
    );
  });

  test("tells an agent that is too old to update first", () => {
    const message = unreadableOutputMessage("claude", release("claude", "2.1.1"));

    expect(message).toStartWith("Couldn't read claude 2.1.1's output");
    expect(message).toContain("`claude update`");
  });
});

/** A fake CLI that answers `--version` with `version` and otherwise runs `script`. */
const answeringVersion = (version: string, script = "") =>
  `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\n${script}`;

describe("the versions agentStatus reports", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("an installed agent carries its version, and a warning when it is too old", async () => {
    await fakes.bin("claude", answeringVersion("2.1.1 (Claude Code)", "exit 1\n"));
    await fakes.bin("codex", answeringVersion("codex-cli 99.0.0", "exit 1\n"));

    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.version).toBe("2.1.1");
    expect(claude?.outdated).toEqual({
      minimum: MIN_AGENT_VERSION.claude,
      update: "claude update",
    });
    expect(codex?.version).toBe("99.0.0");
    expect(codex?.outdated).toBeUndefined();
  });

  test("the update command follows the links on PATH to where the agent was installed", async () => {
    const formula = join(fakes.dir, "Cellar", "codex", "0.1.0", "bin");

    await mkdir(formula, { recursive: true });
    await writeFile(join(formula, "codex"), `#!/bin/sh\n${answeringVersion("codex-cli 0.1.0")}`);
    await chmod(join(formula, "codex"), 0o755);
    await symlink(join(formula, "codex"), join(fakes.dir, "bin", "codex"));

    const [, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(codex?.outdated?.update).toBe("brew upgrade codex");
  });

  test("an agent that does not say its version is still installed and not outdated", async () => {
    await fakes.bin("claude", "echo 'something else'\n");
    await fakes.bin("codex", "exit 3\n");

    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.installed).toBe(true);
    expect(claude?.version).toBeUndefined();
    expect(claude?.outdated).toBeUndefined();
    expect(codex?.installed).toBe(true);
    expect(codex?.version).toBeUndefined();
    expect(codex?.outdated).toBeUndefined();
  });

  test("an agent that is not installed has no version", async () => {
    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.installed).toBe(false);
    expect(claude?.version).toBeUndefined();
    expect(codex?.installed).toBe(false);
    expect(codex?.version).toBeUndefined();
  });

  test("the user's agent is told about each installed agent that is too old", async () => {
    await fakes.bin("claude", answeringVersion("2.1.1 (Claude Code)"));
    await fakes.bin("codex", answeringVersion("codex-cli 0.1.0"));

    const notices = await t.runWith(fakes.layer, agentVersionNotices());

    expect(notices).toHaveLength(2);
    expect(notices.find((notice) => notice.startsWith("Claude Code 2.1.1"))).toContain(
      "`claude update`",
    );

    expect(notices.find((notice) => notice.startsWith("Codex 0.1.0"))).toContain(
      MIN_AGENT_VERSION.codex,
    );
  });

  test("current, unknown and missing agents give no notice", async () => {
    await fakes.bin("claude", answeringVersion("99.0.0 (Claude Code)"));
    await fakes.bin("codex", "echo 'no version here'\n");

    expect(await t.runWith(fakes.layer, agentVersionNotices())).toEqual([]);
  });
});

describe("a run that ends well but says nothing Cutfac can read", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Test");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  /** One turn through the fake `agent` at `bin`, and the sessions it was asked to save. */
  const turn = async (agent: AgentName, bin: string, stored?: string) => {
    const saved: Array<string | undefined> = [];

    const result = await t.run(
      converse({
        agent,
        stored,
        invocation: (session) =>
          Effect.succeed(
            agentInvocation(agent, { bin, prompt: "hi", allowedTools: [], ...session }),
          ),
        save: (session) =>
          Effect.sync(() => {
            saved.push(session);
          }),
        emit: () => Effect.void,
      }),
    );

    return { result, saved };
  };

  /** How many times the fake ran a turn, not counting its `--version`. */
  const runs = async () =>
    (await readFile(join(fakes.calls, "runs"), "utf8").catch(() => "")).split("\n").filter(Boolean)
      .length;

  /** The line that makes the fake note each turn it runs. */
  const countRun = () => `echo run >> "${join(fakes.calls, "runs")}"`;

  test("fails, naming the agent and its version, when claude prints nothing", async () => {
    const bin = await fakes.bin(
      "claude",
      answeringVersion("2.1.301 (Claude Code)", "cat >/dev/null\n"),
    );

    const { result } = await turn("claude", bin);

    expect(result.reply).toBe("");
    expect(result.failure).toBe(
      "Couldn't read claude 2.1.301's output; Cutfac may need an update.",
    );
  });

  test("fails when codex prints only events Cutfac does not know", async () => {
    const bin = await fakes.bin(
      "codex",
      answeringVersion(
        "codex-cli 0.163.0",
        `cat >/dev/null\necho '{"type":"turn.begun"}'\necho 'not json at all'\n`,
      ),
    );

    const { result } = await turn("codex", bin);

    expect(result.failure).toBe("Couldn't read codex 0.163.0's output; Cutfac may need an update.");
  });

  test("fails without a version when the agent does not give one", async () => {
    const bin = await fakes.bin("claude", "cat >/dev/null\n");
    const { result } = await turn("claude", bin);

    expect(result.failure).toBe("Couldn't read claude's output; Cutfac may need an update.");
  });

  test("tells an agent that is too old to update it", async () => {
    const bin = await fakes.bin(
      "claude",
      answeringVersion("2.1.1 (Claude Code)", "cat >/dev/null\n"),
    );

    const { result } = await turn("claude", bin);

    expect(result.failure).toContain("Couldn't read claude 2.1.1's output");
    expect(result.failure).toContain("`claude update`");
  });

  test("an empty reply that was read is not a failure", async () => {
    const bin = await fakes.bin(
      "claude",
      answeringVersion(
        "99.0.0 (Claude Code)",
        `cat >/dev/null
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo '{"type":"result","subtype":"success","session_id":"s1","result":""}'
`,
      ),
    );

    const { result, saved } = await turn("claude", bin);

    expect(result).toEqual({ reply: "", failure: undefined });
    expect(saved).toEqual(["s1"]);
  });

  test("keeps the stored session instead of starting over in a new conversation", async () => {
    const bin = await fakes.bin(
      "claude",
      answeringVersion("99.0.0 (Claude Code)", `cat >/dev/null\n${countRun()}\n`),
    );

    const { result, saved } = await turn("claude", bin, "stored-session");

    expect(result.failure).toContain("Couldn't read claude 99.0.0's output");
    expect(saved).toEqual([]);
    expect(await runs()).toBe(1);
  });

  test("a stored session the agent no longer has is still replaced by a new one", async () => {
    const bin = await fakes.bin(
      "claude",
      answeringVersion(
        "99.0.0 (Claude Code)",
        `cat >/dev/null
${countRun()}
case "$*" in
  *--resume*) echo "No conversation found" >&2; exit 1 ;;
esac
echo '{"type":"system","subtype":"init","session_id":"fresh"}'
echo '{"type":"result","subtype":"success","session_id":"fresh","result":"ok"}'
`,
      ),
    );

    const { result, saved } = await turn("claude", bin, "gone");

    expect(result).toEqual({ reply: "ok", failure: undefined });
    expect(saved).toEqual([undefined, "fresh"]);
    expect(await runs()).toBe(2);
  });
});
