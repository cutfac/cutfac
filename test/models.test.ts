import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { ConfigProvider, Effect, FileSystem, Layer, Option, Schema } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { agentStatus } from "../src/core/agents.ts";
import {
  CLAUDE_MODELS,
  claudeModelName,
  codexConfigModel,
  parseCodexModels,
} from "../src/core/models.ts";
import { ModelSettings } from "../src/core/schema.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Models"), fakeAgents));

const level = (effort: string) => ({ effort, description: `${effort} thinking` });

/** Shaped like `codex debug models`, with fields the board does not read. */
const catalog = JSON.stringify({
  models: [
    {
      slug: "gpt-b",
      display_name: "GPT-B",
      visibility: "list",
      priority: 2,
      default_reasoning_level: "medium",
      supported_reasoning_levels: ["low", "medium", "high"].map(level),
      supports_reasoning_effort_updates: false,
      context_window: 400000,
    },
    {
      slug: "gpt-a",
      display_name: "GPT-A",
      visibility: "list",
      priority: 1,
      default_reasoning_level: "low",
      supported_reasoning_levels: ["low", "medium", "high", "ultra"].map(level),
      supports_reasoning_effort_updates: true,
    },
    { slug: "gpt-hidden", visibility: "hide", priority: 0, supported_reasoning_levels: [] },
    {
      slug: "--bad",
      visibility: "list",
      priority: 3,
      supported_reasoning_levels: [level("low")],
    },
  ],
});

describe("the models an agent can run", () => {
  test("codex lists its shown models in order, with the efforts each takes", () => {
    // Whether a change of effort keeps the cache is checked with the property itself, which
    // `toEqual` would let go missing.
    expect(parseCodexModels(catalog).models.map((m) => m.effortKeepsCache)).toEqual([true, false]);
    expect(parseCodexModels(catalog)).toEqual({
      models: [
        {
          id: "gpt-a",
          label: "GPT-A",
          efforts: ["low", "medium", "high", "ultra"],
          defaultEffort: "low",
          effortKeepsCache: true,
        },
        {
          id: "gpt-b",
          label: "GPT-B",
          efforts: ["low", "medium", "high"],
          defaultEffort: "medium",
          effortKeepsCache: false,
        },
      ],
      efforts: ["low", "medium", "high"],
    });
  });

  test("a catalog codex cannot give leaves the picker without models", () => {
    for (const text of ["", "not json", '{"models":"none"}', "[]"]) {
      expect(parseCodexModels(text)).toEqual({ models: [], efforts: [] });
    }
  });

  test("a model or effort that could pass for a flag or break the config is refused", () => {
    const decode = Schema.decodeUnknownOption(ModelSettings);

    for (const settings of [
      { model: "opus", effort: "high" },
      { model: "claude-opus-5-5[1m]" },
      { model: "gpt-6.1-sol" },
    ]) {
      expect(decode(settings)._tag).toBe("Some");
    }

    for (const settings of [
      { model: "--dangerously-skip-permissions" },
      { model: "opus x" },
      { model: "a".repeat(101) },
      { effort: 'high"\nsandbox_mode="danger-full-access' },
      { effort: "High" },
    ]) {
      expect(decode(settings)._tag).toBe("None");
    }
  });
});

/** The value after `flag` in `args`, if the flag is there. */
const after = (args: ReadonlyArray<string>, flag: string) => {
  const at = args.indexOf(flag);

  return at === -1 ? undefined : args[at + 1];
};

describe("running on a model", () => {
  const opts = {
    bin: "/bin/x",
    prompt: "do it",
    sessionId: undefined,
    newSessionId: "new",
  };

  test("claude takes --model and --effort", () => {
    const args = agentInvocation("claude", { ...opts, model: "opus", effort: "max" }).args;

    expect([after(args, "--model"), after(args, "--effort")]).toEqual(["opus", "max"]);
  });

  /** What a Codex run asks for: the thread it starts, then the turn on it. */
  const codexRequests = (options: { readonly model?: string; readonly effort?: string }) => {
    const { parse } = agentInvocation("codex", { ...opts, ...options });

    const params = (line: string) => {
      const control = parse(line, undefined).control;

      return control?.kind === "reply" ? JSON.parse(control.lines.at(-1) ?? "{}").params : {};
    };

    return {
      thread: params('{"id":1,"result":{}}'),
      turn: params('{"id":2,"result":{"thread":{"id":"t1"}}}'),
    };
  };

  test("codex starts the thread on the model and the turn at the effort", () => {
    const { thread, turn } = codexRequests({ model: "gpt-a", effort: "high" });

    expect(thread.model).toBe("gpt-a");
    expect(turn.effort).toBe("high");
  });

  test("left out, each CLI keeps its own default", () => {
    const args = agentInvocation("claude", opts).args;

    expect(args.some((arg) => ["--model", "--effort"].includes(arg))).toBe(false);

    const { thread, turn } = codexRequests({});

    expect("model" in thread || "effort" in turn).toBe(false);
  });
});

describe("the model an agent picks itself", () => {
  test("a Claude model goes by the name people know it by", () => {
    expect(claudeModelName("claude-opus-5-5")).toEqual(Option.some("Opus 5.5"));
    expect(claudeModelName("claude-sonnet-5")).toEqual(Option.some("Sonnet 5"));
    expect(claudeModelName("claude-haiku-4-5-20251001")).toEqual(Option.some("Haiku 4.5"));
    expect(claudeModelName("claude-opus-4-6[1m]")).toEqual(Option.some("Opus 4.6"));
    expect(claudeModelName("claude-3-5-sonnet-20241022")).toEqual(Option.some("Sonnet 3.5"));
    expect(claudeModelName("opus")).toEqual(Option.some("Opus 5.5"));
    expect(claudeModelName("Opus[1m]")).toEqual(Option.some("Opus 5.5"));
    expect(claudeModelName("us.anthropic.custom")).toEqual(Option.some("us.anthropic.custom"));
    expect(claudeModelName("default")).toEqual(Option.none());
    expect(claudeModelName(" ")).toEqual(Option.none());
  });

  test("Codex's config sets it, through the profile in use when there is one", () => {
    expect(codexConfigModel('model = "gpt-b"\n[tui]\ntheme = "dark"\n')).toEqual(
      Option.some("gpt-b"),
    );
    expect(
      codexConfigModel(
        'model = "gpt-b"\nprofile = "fast"\n[profiles.fast]\nmodel = "gpt-a"\n[profiles.slow]\n',
      ),
    ).toEqual(Option.some("gpt-a"));
    expect(codexConfigModel('profile = "slow"\nmodel = "gpt-b"\n[profiles.slow]\n')).toEqual(
      Option.some("gpt-b"),
    );
    expect(codexConfigModel("[tui]\n")).toEqual(Option.none());
    expect(codexConfigModel("model = ")).toEqual(Option.none());
  });
});

const claudeSettings = (dir: string, name: string) => join(dir, ".claude", name);

describe("agent status", () => {
  it.live("offers claude's aliases and the models the installed codex lists", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;

      yield* fakes.bin("claude", "exit 0\n");
      yield* fakes.bin(
        "codex",
        `if [ "$1 $2" = "debug models" ]; then cat <<'JSON'
${catalog}
JSON
exit 0; fi
exit 1
`,
      );

      const [claude, codex] = yield* agentStatus();

      expect(claude).toMatchObject({ agent: "claude", installed: true, ...CLAUDE_MODELS });
      expect(codex).toMatchObject({ agent: "codex", installed: true, connected: false });
      expect(codex?.models.map((m) => m.id)).toEqual(["gpt-a", "gpt-b"]);
    }),
  );

  it.live("names the model each agent runs when none is picked, as its own settings set it", () =>
    Effect.gen(function* () {
      const fakes = yield* FakeAgentDir;
      const fs = yield* FileSystem.FileSystem;
      const ws = yield* Workspace;
      const home = join(fakes.dir, "home");

      yield* fs.makeDirectory(join(home, ".claude"), { recursive: true });
      yield* fs.makeDirectory(join(home, ".codex"));
      yield* fs.makeDirectory(join(ws.root, ".claude"));
      yield* fs.writeFileString(
        claudeSettings(home, "settings.json"),
        '{"model":"claude-opus-5-5"}',
      );
      yield* fs.writeFileString(join(home, ".codex/config.toml"), 'model = "gpt-b"\n');
      yield* fakes.bin("claude", "exit 0\n");
      yield* fakes.bin("codex", `[ "$1 $2" = "debug models" ] && cat <<'JSON'\n${catalog}\nJSON\n`);

      const env = { PATH: join(fakes.dir, "bin"), HOME: home };

      const named = Effect.map(agentStatus(), (agents) =>
        agents.map((agent) => agent.defaultModel),
      ).pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })));

      expect(yield* named).toEqual(["Opus 5.5", "GPT-B"]);

      yield* fs.writeFileString(claudeSettings(ws.root, "settings.json"), '{"model":"sonnet"}');
      expect((yield* named)[0]).toBe("Sonnet 5.5");
      yield* fs.writeFileString(
        claudeSettings(ws.root, "settings.local.json"),
        '{"model":"claude-haiku-4-5"}',
      );
      expect((yield* named)[0]).toBe("Haiku 4.5");

      yield* fs.remove(join(ws.root, ".claude"), { recursive: true });
      yield* fs.remove(join(home, ".codex/config.toml"));

      const [claude, codex] = yield* agentStatus();

      expect(claude?.defaultModel).toBeUndefined();
      expect(codex?.defaultModel).toBe("GPT-A");
    }),
  );

  it.live("an agent that is not installed offers nothing to pick", () =>
    Effect.gen(function* () {
      const [, codex] = yield* agentStatus();

      expect(codex).toMatchObject({ installed: false, models: [], efforts: [] });
    }),
  );
});
