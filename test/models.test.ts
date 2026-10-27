import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ConfigProvider, Option, Schema } from "effect";

import { agentInvocation } from "../src/core/agentCommand.ts";
import { agentStatus } from "../src/core/agents.ts";
import {
  CLAUDE_MODELS,
  claudeModelName,
  codexConfigModel,
  parseCodexModels,
} from "../src/core/models.ts";
import { ModelSettings } from "../src/core/schema.ts";
import { type FakeAgents, makeFakeAgents, makeWorkspace, type TestWorkspace } from "./support.ts";

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

describe("agent status", () => {
  let t: TestWorkspace;
  let fakes: FakeAgents;

  beforeEach(async () => {
    t = await makeWorkspace("Models");
    fakes = await makeFakeAgents();
  });

  afterEach(async () => {
    await fakes.remove();
    await t.remove();
  });

  test("offers claude's aliases and the models the installed codex lists", async () => {
    await fakes.bin("claude", "exit 0\n");
    await fakes.bin(
      "codex",
      `if [ "$1 $2" = "debug models" ]; then cat <<'JSON'
${catalog}
JSON
exit 0; fi
exit 1
`,
    );

    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude).toMatchObject({ agent: "claude", installed: true, ...CLAUDE_MODELS });
    expect(codex).toMatchObject({ agent: "codex", installed: true, connected: false });
    expect(codex?.models.map((m) => m.id)).toEqual(["gpt-a", "gpt-b"]);
  });

  test("names the model each agent runs when none is picked, as its own settings set it", async () => {
    const home = join(fakes.dir, "home");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".codex"));
    await mkdir(join(t.root, ".claude"));
    await writeFile(join(home, ".claude/settings.json"), '{"model":"claude-opus-5-5"}');
    await writeFile(join(home, ".codex/config.toml"), 'model = "gpt-b"\n');
    await fakes.bin("claude", "exit 0\n");
    await fakes.bin("codex", `[ "$1 $2" = "debug models" ] && cat <<'JSON'\n${catalog}\nJSON\n`);

    const env = { PATH: join(fakes.dir, "bin"), HOME: home };
    const layer = ConfigProvider.layer(ConfigProvider.fromEnv({ env }));
    const status = () => t.runWith(layer, agentStatus());
    const named = async () => (await status()).map((agent) => agent.defaultModel);

    expect(await named()).toEqual(["Opus 5.5", "GPT-B"]);

    // The workspace's own settings come before the user's, and its local ones before both.
    await writeFile(join(t.root, ".claude/settings.json"), '{"model":"sonnet"}');
    expect((await named())[0]).toBe("Sonnet 5.5");
    await writeFile(join(t.root, ".claude/settings.local.json"), '{"model":"claude-haiku-4-5"}');
    expect((await named())[0]).toBe("Haiku 4.5");

    // Set nowhere, Claude's pick is unknown and Codex's is the first model it lists.
    await rm(join(t.root, ".claude"), { recursive: true });
    await rm(join(home, ".codex/config.toml"));
    const [claude, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(claude?.defaultModel).toBeUndefined();
    expect(codex?.defaultModel).toBe("GPT-A");
  });

  test("an agent that is not installed offers nothing to pick", async () => {
    const [, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(codex).toMatchObject({ installed: false, models: [], efforts: [] });
  });
});
