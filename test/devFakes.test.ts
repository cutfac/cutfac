import { describe, expect, test } from "bun:test";

import {
  checksAgents,
  fakeFix,
  freshFolderName,
  NO_FAKES,
  withFakes,
} from "../electron/devFakes.ts";
import type { AgentSetup } from "../src/core/agentReadiness.ts";

const CODEX: AgentSetup = { agent: "codex", state: "missing", fix: "npm install -g @openai/codex" };

const REAL: AgentSetup[] = [{ agent: "claude", state: "ready", version: "2.1.0" }, CODEX];

describe("withFakes", () => {
  test("leaves the real check alone without fakes", () => {
    expect(withFakes(REAL, NO_FAKES.agents)).toEqual(REAL);
    expect(checksAgents(NO_FAKES)).toBe(true);
  });

  test("swaps in each faked agent, in the usual order", () => {
    expect(withFakes(REAL, { claude: "signedOut", codex: "real" })).toEqual([
      {
        agent: "claude",
        state: "signedOut",
        version: "9.9.9",
        fix: fakeFix("claude", "signedOut"),
      },
      CODEX,
    ]);
  });

  test("needs no real check when every agent is faked", () => {
    const fakes = { ...NO_FAKES, agents: { claude: "ready", codex: "outdated" } } as const;

    expect(checksAgents(fakes)).toBe(false);
    expect(withFakes([], fakes.agents)).toEqual([
      { agent: "claude", state: "ready", version: "9.9.9" },
      { agent: "codex", state: "outdated", version: "0.0.1", fix: fakeFix("codex", "outdated") },
    ]);
  });

  test("offers a fix that only prints, so running it changes nothing", () => {
    expect(fakeFix("codex", "missing")).toBe('echo "Dev Panel: pretend to install codex"');
  });
});

test("names each fresh folder by when it was made", () => {
  expect(freshFolderName(new Date(2026, 9, 22, 9, 5, 7))).toBe("2026-10-22 09.05.07");
});
