import { describe, expect, test } from "bun:test";

import type { AgentStatus } from "../web/src/api.ts";
import { en } from "../web/src/i18n/en.tsx";
import { ko } from "../web/src/i18n/ko.tsx";
import {
  effortsFor,
  offersModels,
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

  test("an agent with nothing to pick shows no picker", () => {
    expect(offersModels(codex)).toBe(true);
    expect(offersModels(claude)).toBe(false);
    expect(offersModels(undefined)).toBe(false);
  });

  test("a request always names a model and effort the agent offers", () => {
    expect(usableSettings(codex, { model: "gpt-a", effort: "ultra" })).toEqual({
      model: "gpt-a",
      effort: "ultra",
    });
    // Moving to a model that does not take the effort moves the effort to one it does.
    expect(usableSettings(codex, { model: "gpt-b", effort: "ultra" })).toEqual({
      model: "gpt-b",
      effort: "medium",
    });
    // With nothing picked, or a model gone, the agent's first model runs with its own effort.
    expect(usableSettings(codex, undefined)).toEqual({ model: "gpt-a", effort: "low" });
    expect(usableSettings(codex, { model: "gone", effort: "medium" })).toEqual({
      model: "gpt-a",
      effort: "medium",
    });
    expect(usableSettings(claude, { model: "opus" })).toEqual({});
    expect(usableSettings(undefined, { model: "opus" })).toEqual({});
  });

  test("the agent's own default model is the one picked when it names one", () => {
    expect(usableSettings({ ...codex, defaultModel: "GPT-B" }, {})).toEqual({
      model: "gpt-b",
      effort: "medium",
    });
    // Claude names a release, such as Opus 5.5, of an alias it lists as Opus.
    const opus = { id: "opus", label: "Opus", efforts: ["low", "high", "max"] };
    const sonnet = { id: "sonnet", label: "Sonnet", efforts: ["low", "high", "max"] };

    expect(
      usableSettings({ ...codex, models: [sonnet, opus], defaultModel: "Opus 5.5" }, {}),
    ).toEqual({ model: "opus", effort: "high" });
  });

  test("each agent sends its own pick, and a copied prompt none", () => {
    const picks = { codex: { model: "gpt-b", effort: "medium" }, claude: { model: "opus" } };

    expect(pickedSettings([claude, codex], picks, "codex")).toEqual(picks.codex);
    expect(pickedSettings([claude, codex], picks, "claude")).toEqual({});
    expect(pickedSettings([claude, codex], picks, "queue")).toEqual({});
    expect(pickedSettings(undefined, picks, "codex")).toEqual({});
  });

  test("a run names its model as listed and its effort in the user's language", () => {
    expect(settingsLabels(codex, { model: "gpt-a", effort: "high" }, en)).toEqual([
      "GPT-A",
      "High",
    ]);
    expect(settingsLabels(codex, { effort: "xhigh" }, ko)).toEqual(["매우 높음"]);
    // A model or effort the board has no name for shows as the agent names it.
    expect(settingsLabels(undefined, { model: "gpt-z", effort: "ultra" }, en)).toEqual([
      "gpt-z",
      "ultra",
    ]);
    expect(settingsLabels(codex, {}, en)).toEqual([]);
  });
});
