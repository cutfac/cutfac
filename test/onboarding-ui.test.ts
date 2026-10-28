import { expect, test } from "bun:test";

import type { AgentStatus } from "../web/src/api.ts";
import { agentsToConnect, asWebsite, needsStart } from "../web/src/lib/onboarding.ts";

const status = (agent: AgentStatus["agent"], rest: Partial<AgentStatus>): AgentStatus => ({
  agent,
  installed: true,
  connected: false,
  models: [],
  efforts: [],
  ...rest,
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

test("only a workspace with nothing yet opens on its first template", () => {
  expect(needsStart(0, false, false)).toBe(true);
  expect(needsStart(1, false, false)).toBe(false);
  expect(needsStart(0, true, false)).toBe(false);
  expect(needsStart(0, false, true)).toBe(false);
});

test("a website typed without its scheme is read over https", () => {
  expect(asWebsite(" yourwebsite.com ")).toBe("https://yourwebsite.com");
  expect(asWebsite("http://example.com")).toBe("http://example.com");
  expect(asWebsite("  ")).toBe("");
});
