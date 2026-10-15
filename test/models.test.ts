import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Schema } from "effect";

import { agentInvocation } from "../src/core/agentRun.ts";
import { agentStatus } from "../src/core/agents.ts";
import { CLAUDE_MODELS, parseCodexModels } from "../src/core/models.ts";
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
      context_window: 400000,
    },
    {
      slug: "gpt-a",
      display_name: "GPT-A",
      visibility: "list",
      priority: 1,
      default_reasoning_level: "low",
      supported_reasoning_levels: ["low", "medium", "high", "ultra"].map(level),
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
    expect(parseCodexModels(catalog)).toEqual({
      models: [
        {
          id: "gpt-a",
          label: "GPT-A",
          efforts: ["low", "medium", "high", "ultra"],
          defaultEffort: "low",
        },
        {
          id: "gpt-b",
          label: "GPT-B",
          efforts: ["low", "medium", "high"],
          defaultEffort: "medium",
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
    allowedTools: ["Read"],
  };

  test("claude takes --model and --effort", () => {
    const args = agentInvocation("claude", { ...opts, model: "opus", effort: "max" }).args;

    expect([after(args, "--model"), after(args, "--effort")]).toEqual(["opus", "max"]);
  });

  test("codex takes -m and the reasoning effort as config", () => {
    const args = agentInvocation("codex", { ...opts, model: "gpt-a", effort: "high" }).args;

    expect(after(args, "-m")).toBe("gpt-a");
    expect(args).toContain('model_reasoning_effort="high"');
  });

  test("left out, each CLI keeps its own default", () => {
    for (const agent of ["claude", "codex"] as const) {
      const args = agentInvocation(agent, opts).args;

      expect(args.some((arg) => ["--model", "--effort", "-m"].includes(arg))).toBe(false);
      expect(args.some((arg) => arg.startsWith("model_reasoning_effort"))).toBe(false);
    }
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

  test("an agent that is not installed offers nothing to pick", async () => {
    const [, codex] = await t.runWith(fakes.layer, agentStatus());

    expect(codex).toMatchObject({ installed: false, models: [], efforts: [] });
  });
});
