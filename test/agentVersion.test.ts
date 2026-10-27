import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, Option, Ref } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { agentStatus } from "../src/core/agents.ts";
import { converse } from "../src/core/agentTurn.ts";
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
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Test"), fakeAgents));

describe("parseAgentVersion", () => {
  test("reads what claude and codex print", () => {
    expect(parseAgentVersion("2.1.301 (Claude Code)\n")).toEqual(Option.some("2.1.301"));
    expect(parseAgentVersion("codex-cli 0.163.0\n")).toEqual(Option.some("0.163.0"));
  });

  test("keeps the release of a prerelease or a prefixed number", () => {
    expect(parseAgentVersion("codex-cli 0.164.0-alpha.2")).toEqual(Option.some("0.164.0"));
    expect(parseAgentVersion("v1.2.3")).toEqual(Option.some("1.2.3"));
  });

  test("says nothing for output that holds no release number", () => {
    expect(parseAgentVersion("")).toEqual(Option.none());
    expect(parseAgentVersion("command not found")).toEqual(Option.none());
    expect(parseAgentVersion("1.2")).toEqual(Option.none());
    expect(parseAgentVersion("listening on 10.0.0.1")).toEqual(Option.none());
  });

  test("the minimums are releases it can read", () => {
    for (const minimum of Object.values(MIN_AGENT_VERSION)) {
      expect(parseAgentVersion(minimum)).toEqual(Option.some(minimum));
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

const known = (agent: AgentName, version: string) => Option.some(release(agent, version));

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
    expect(outdatedAgent("claude", known("claude", "2.1.1"))).toEqual(
      Option.some({ minimum: MIN_AGENT_VERSION.claude, update: "claude update" }),
    );

    expect(
      Option.map(outdatedAgent("codex", known("codex", "0.1.0")), (outdated) => outdated.minimum),
    ).toEqual(Option.some(MIN_AGENT_VERSION.codex));
    expect(outdatedAgent("claude", known("claude", MIN_AGENT_VERSION.claude))).toEqual(
      Option.none(),
    );
    expect(outdatedAgent("claude", known("claude", "99.0.0"))).toEqual(Option.none());
  });

  test("an unknown version is never outdated", () => {
    expect(outdatedAgent("claude", Option.none())).toEqual(Option.none());
    expect(outdatedAgent("codex", Option.none())).toEqual(Option.none());
  });

  test("the notice names the agent, both versions and the command", () => {
    const outdated = Option.getOrThrow(outdatedAgent("claude", known("claude", "2.1.1")));
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
    expect(unreadableOutputMessage("claude", known("claude", "99.0.0"))).toBe(
      "Couldn't read claude 99.0.0's output; Cutfac may need an update.",
    );
  });

  test("leaves the version out when it is not known", () => {
    expect(unreadableOutputMessage("codex", Option.none())).toBe(
      "Couldn't read codex's output; Cutfac may need an update.",
    );
  });

  test("tells an agent that is too old to update first", () => {
    const message = unreadableOutputMessage("claude", known("claude", "2.1.1"));

    expect(message).toStartWith("Couldn't read claude 2.1.1's output");
    expect(message).toContain("`claude update`");
  });
});

/** A fake CLI that answers `--version` with `version` and otherwise runs `script`. */
const answeringVersion = (version: string, script = "") =>
  `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\n${script}`;

const countRun = (calls: string) => `echo run >> "${join(calls, "runs")}"`;

describe("the versions agentStatus reports", () => {
  it.live("an installed agent carries its version, and a warning when it is too old", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", answeringVersion("2.1.1 (Claude Code)", "exit 1\n"));
      yield* fakes.bin("codex", answeringVersion("codex-cli 99.0.0", "exit 1\n"));

      const [claude, codex] = yield* agentStatus();

      expect(claude?.version).toBe("2.1.1");
      expect(claude?.outdated).toEqual({
        minimum: MIN_AGENT_VERSION.claude,
        update: "claude update",
      });
      expect(codex?.version).toBe("99.0.0");
      expect(codex?.outdated).toBeUndefined();
    }),
  );

  it.live("the update command follows the links on PATH to where the agent was installed", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const fs = yield* FileSystem.FileSystem;
      const formula = join(fakes.dir, "Cellar", "codex", "0.1.0", "bin");

      yield* fs.makeDirectory(formula, { recursive: true });
      yield* fs.writeFileString(
        join(formula, "codex"),
        `#!/bin/sh\n${answeringVersion("codex-cli 0.1.0")}`,
      );
      yield* fs.chmod(join(formula, "codex"), 0o755);
      yield* fs.symlink(join(formula, "codex"), join(fakes.dir, "bin", "codex"));

      const [, codex] = yield* agentStatus();

      expect(codex?.outdated?.update).toBe("brew upgrade codex");
    }),
  );

  it.live("an agent that does not say its version is still installed and not outdated", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", "echo 'something else'\n");
      yield* fakes.bin("codex", "exit 3\n");

      const [claude, codex] = yield* agentStatus();

      expect(claude?.installed).toBe(true);
      expect(claude?.version).toBeUndefined();
      expect(claude?.outdated).toBeUndefined();
      expect(codex?.installed).toBe(true);
      expect(codex?.version).toBeUndefined();
      expect(codex?.outdated).toBeUndefined();
    }),
  );

  it.live("an agent that is not installed has no version", () =>
    Effect.gen(function* () {
      const [claude, codex] = yield* agentStatus();

      expect(claude?.installed).toBe(false);
      expect(claude?.version).toBeUndefined();
      expect(codex?.installed).toBe(false);
      expect(codex?.version).toBeUndefined();
    }),
  );

  it.live("the user's agent is told about each installed agent that is too old", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", answeringVersion("2.1.1 (Claude Code)"));
      yield* fakes.bin("codex", answeringVersion("codex-cli 0.1.0"));

      const notices = yield* agentVersionNotices();

      expect(notices).toHaveLength(2);
      expect(notices.find((notice) => notice.startsWith("Claude Code 2.1.1"))).toContain(
        "`claude update`",
      );

      expect(notices.find((notice) => notice.startsWith("Codex 0.1.0"))).toContain(
        MIN_AGENT_VERSION.codex,
      );
    }),
  );

  it.live("current, unknown and missing agents give no notice", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", answeringVersion("99.0.0 (Claude Code)"));
      yield* fakes.bin("codex", "echo 'no version here'\n");

      expect(yield* agentVersionNotices()).toEqual([]);
    }),
  );
});

describe("a run that ends well but says nothing Cutfac can read", () => {
  /** One turn through the fake `agent` at `bin`, and the sessions it was asked to save. */
  const turn = Effect.fnUntraced(function* (agent: AgentName, bin: string, stored?: string) {
    const saved = yield* Ref.make<ReadonlyArray<string | undefined>>([]);

    const result = yield* converse({
      agent,
      stored,
      invocation: (session) =>
        Effect.succeed(agentInvocation(agent, { bin, prompt: "hi", ...session })),
      save: (session) => Ref.update(saved, (all) => [...all, session]),
      emit: () => Effect.void,
    });

    return { result, saved: yield* Ref.get(saved) };
  });

  /** How many times the fake ran a turn, not counting its `--version`. */
  const runs = Effect.gen(function* () {
    const fakes = yield* FakeAgentDir;
    const fs = yield* FileSystem.FileSystem;

    const text = yield* fs
      .readFileString(join(fakes.calls, "runs"))
      .pipe(Effect.orElseSucceed(() => ""));

    return text.split("\n").filter(Boolean).length;
  });

  const STORED = "5f0c6a52-6f1e-4c43-9d2a-0c1d2e3f4a5b";

  it.live("fails, naming the agent and its version, when claude prints nothing", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "claude",
        answeringVersion("2.1.301 (Claude Code)", "head -n 1 >/dev/null\n"),
      );

      const { result } = yield* turn("claude", bin);

      expect(result.reply).toBe("");
      expect(result.failure).toBe(
        "Couldn't read claude 2.1.301's output; Cutfac may need an update.",
      );
    }),
  );

  it.live("fails when codex prints only events Cutfac does not know", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "codex",
        answeringVersion(
          "codex-cli 0.163.0",
          `head -n 1 >/dev/null\necho '{"method":"turn/begun"}'\necho 'not json at all'\n`,
        ),
      );

      const { result } = yield* turn("codex", bin);

      expect(result.failure).toBe(
        "Couldn't read codex 0.163.0's output; Cutfac may need an update.",
      );
    }),
  );

  it.live("fails without a version when the agent does not give one", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const bin = yield* fakes.bin("claude", "head -n 1 >/dev/null\n");
      const { result } = yield* turn("claude", bin);

      expect(result.failure).toBe("Couldn't read claude's output; Cutfac may need an update.");
    }),
  );

  it.live("tells an agent that is too old to update it", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "claude",
        answeringVersion("2.1.1 (Claude Code)", "head -n 1 >/dev/null\n"),
      );

      const { result } = yield* turn("claude", bin);

      expect(result.failure).toContain("Couldn't read claude 2.1.1's output");
      expect(result.failure).toContain("`claude update`");
    }),
  );

  it.live("an empty reply that was read is not a failure", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "claude",
        answeringVersion(
          "99.0.0 (Claude Code)",
          `head -n 1 >/dev/null
echo '{"type":"system","subtype":"init","session_id":"s1"}'
echo '{"type":"result","subtype":"success","session_id":"s1","result":""}'
`,
        ),
      );

      const { result, saved } = yield* turn("claude", bin);

      expect(result).toEqual({ reply: "", failure: undefined });
      expect(saved).toEqual(["s1"]);
    }),
  );

  it.live("keeps the stored session instead of starting over in a new conversation", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "claude",
        answeringVersion(
          "99.0.0 (Claude Code)",
          `head -n 1 >/dev/null\n${countRun(fakes.calls)}\n`,
        ),
      );

      const { result, saved } = yield* turn("claude", bin, STORED);

      expect(result.failure).toContain("Couldn't read claude 99.0.0's output");
      expect(saved).toEqual([]);
      expect(yield* runs).toBe(1);
    }),
  );

  it.live("a stored session the agent no longer has is still replaced by a new one", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      const bin = yield* fakes.bin(
        "claude",
        answeringVersion(
          "99.0.0 (Claude Code)",
          `head -n 1 >/dev/null
${countRun(fakes.calls)}
case "$*" in
  *--resume*) echo "No conversation found" >&2; exit 1 ;;
esac
echo '{"type":"system","subtype":"init","session_id":"fresh"}'
echo '{"type":"result","subtype":"success","session_id":"fresh","result":"ok"}'
`,
        ),
      );

      const { result, saved } = yield* turn("claude", bin, STORED);

      expect(result).toEqual({ reply: "ok", failure: undefined });
      expect(saved).toEqual([undefined, "fresh"]);
      expect(yield* runs).toBe(2);
    }),
  );
});
