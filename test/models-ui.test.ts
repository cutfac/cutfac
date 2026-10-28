import { describe, expect, test } from "bun:test";

import { Option } from "effect";

import type { AgentStatus } from "../web/src/api.ts";
import { en } from "../web/src/i18n/en.tsx";
import { ko } from "../web/src/i18n/ko.tsx";
import {
  effortsFor,
  pickedSettings,
  settingsLabels,
  usableSettings,
} from "../web/src/lib/models.ts";

const codex: AgentStatus = {
  agent: "codex",
  installed: true,
  connected: true,
  models: [
    {
      id: "gpt-a",
      label: "GPT-A",
      efforts: ["low", "medium", "high", "ultra"],
      defaultEffort: "low",
    },
    { id: "gpt-b", label: "GPT-B", efforts: ["low", "medium"] },
    { id: "gpt-c", label: "GPT-C", efforts: ["low", "high"], defaultEffort: "high" },
  ],
  efforts: ["low", "medium"],
};

const claude: AgentStatus = {
  agent: "claude",
  installed: false,
  connected: false,
  models: [],
  efforts: [],
};

describe("picking a model and effort", () => {
  test("the efforts offered follow the picked model, else suit the agent's own pick", () => {
    expect(effortsFor(codex, "gpt-a")).toEqual(["low", "medium", "high", "ultra"]);
    expect(effortsFor(codex, undefined)).toEqual(["low", "medium"]);
    expect(effortsFor(codex, "gone")).toEqual(["low", "medium"]);
  });

  test("a request always names a model and effort the agent offers", () => {
    expect(usableSettings(Option.some(codex), { model: "gpt-a", effort: "ultra" })).toEqual({
      model: "gpt-a",
      effort: "ultra",
    });
    // Moving to a model that does not take the effort moves the effort to one it does.
    expect(usableSettings(Option.some(codex), { model: "gpt-b", effort: "ultra" })).toEqual({
      model: "gpt-b",
      effort: "medium",
    });
    // With nothing picked, or a model gone, the agent's first model runs at Medium.
    expect(usableSettings(Option.some(codex), undefined)).toEqual({
      model: "gpt-a",
      effort: "medium",
    });
    // A model without Medium runs at its own effort.
    expect(usableSettings(Option.some(codex), { model: "gpt-c" })).toEqual({
      model: "gpt-c",
      effort: "high",
    });
    expect(usableSettings(Option.some(codex), { model: "gone", effort: "medium" })).toEqual({
      model: "gpt-a",
      effort: "medium",
    });
    expect(usableSettings(Option.some(claude), { model: "opus" })).toEqual({});
    expect(usableSettings(Option.none(), { model: "opus" })).toEqual({});
  });

  test("with nothing picked, the first listed model runs whatever the agent's config names", () => {
    expect(usableSettings(Option.some({ ...codex, defaultModel: "GPT-B" }), {})).toEqual({
      model: "gpt-a",
      effort: "medium",
    });
  });

  test("each agent sends its own pick, and a copied prompt none", () => {
    const picks = { codex: { model: "gpt-b", effort: "medium" }, claude: { model: "opus" } };

    expect(pickedSettings([claude, codex], picks, "codex")).toEqual(picks.codex);
    expect(pickedSettings([claude, codex], picks, "claude")).toEqual({});
    expect(pickedSettings([claude, codex], picks, "queue")).toEqual({});
    expect(pickedSettings(undefined, picks, "codex")).toEqual({});
  });

  test("a run names its model as listed and its effort in the user's language", () => {
    expect(settingsLabels(Option.some(codex), { model: "gpt-a", effort: "high" }, en)).toEqual([
      "GPT-A",
      "High",
    ]);
    expect(settingsLabels(Option.some(codex), { effort: "xhigh" }, ko)).toEqual(["매우 높음"]);
    // A model or effort the board has no name for shows as the agent names it.
    expect(settingsLabels(Option.none(), { model: "gpt-z", effort: "ultra" }, en)).toEqual([
      "gpt-z",
      "ultra",
    ]);
    expect(settingsLabels(Option.some(codex), {}, en)).toEqual([]);
  });
});
