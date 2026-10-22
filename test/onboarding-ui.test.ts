import { describe, expect, test } from "bun:test";

import type { AgentStatus } from "../web/src/api.ts";
import type { AgentSetup } from "../web/src/desktop.ts";
import {
  agentsToConnect,
  needsStart,
  onboardingAgent,
  runPhase,
} from "../web/src/lib/onboarding.ts";

const setup = (agent: AgentSetup["agent"], state: AgentSetup["state"]): AgentSetup => ({
  agent,
  state,
});

const status = (agent: AgentStatus["agent"], rest: Partial<AgentStatus>): AgentStatus => ({
  agent,
  installed: true,
  connected: false,
  models: [],
  efforts: [],
  ...rest,
});

describe("the agent that makes the first template", () => {
  test("the workspace default, when it is ready", () => {
    const both = [setup("claude", "ready"), setup("codex", "ready")];

    expect(onboardingAgent("codex", both)).toBe("codex");
  });

  test("else the first ready one, whatever the default", () => {
    const setups = [setup("claude", "signedOut"), setup("codex", "ready")];

    expect(onboardingAgent("claude", setups)).toBe("codex");
    expect(onboardingAgent("queue", setups)).toBe("codex");
    expect(onboardingAgent(undefined, [setup("claude", "missing")])).toBeUndefined();
  });
});

test("a new workspace connects every recent agent that isn't connected yet", () => {
  const statuses = [
    status("claude", { outdated: { minimum: "2.2.0", update: "claude update" } }),
    status("codex", {}),
  ];

  expect(agentsToConnect(statuses)).toEqual(["codex"]);
  expect(agentsToConnect([status("claude", { connected: true })])).toEqual([]);
  expect(agentsToConnect([status("claude", { installed: false })])).toEqual([]);
});

describe("how far a template run has come", () => {
  test("from reading to writing to checking, in either agent's tool names", () => {
    expect(runPhase([])).toBe("reading");
    expect(runPhase([{ kind: "tool", name: "WebFetch" }])).toBe("reading");
    expect(runPhase([{ kind: "tool", name: "mcp__cutfac__save_format" }])).toBe("writing");
    expect(runPhase([{ kind: "tool", name: "edit" }])).toBe("writing");
    expect(runPhase([{ kind: "tool", name: "check_format" }])).toBe("checking");
  });

  test("a fix after a check still reads as checking", () => {
    const steps = [
      { kind: "tool", name: "mcp__cutfac__check_format" },
      { kind: "text", text: "One thing to fix." },
      { kind: "tool", name: "Edit" },
    ] as const;

    expect(runPhase(steps)).toBe("checking");
  });
});

test("only a workspace with nothing yet opens on its first template", () => {
  expect(needsStart(0, false, false)).toBe(true);
  expect(needsStart(1, false, false)).toBe(false);
  expect(needsStart(0, true, false)).toBe(false);
  expect(needsStart(0, false, true)).toBe(false);
});
