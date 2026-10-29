import { describe, expect, test } from "bun:test";

import type { AgentName } from "../web/src/api.ts";
import type { AgentFix, AgentSetup } from "../web/src/desktop.ts";
import { type SignIn, signIn } from "../web/src/lib/agent-sign-in.ts";

/** The desktop app as the sign-in sees it: what the check finds, and how a fix goes. */
function app(found: AgentSetup["state"] | Error, fix: AgentFix = { ok: true, command: "x" }) {
  const fixed: AgentName[] = [];

  return {
    fixed,
    onboarding: {
      agents: () =>
        found instanceof Error
          ? Promise.reject(found)
          : Promise.resolve<AgentSetup[]>([{ agent: "claude", state: found }]),
      fixAgent: (agent: AgentName) => {
        fixed.push(agent);

        return Promise.resolve(fix);
      },
    },
  };
}

async function steps(found: AgentSetup["state"] | Error, fix?: AgentFix) {
  const { onboarding, fixed } = app(found, fix);
  const seen: SignIn[] = [];

  await signIn(onboarding, "claude", (next) => seen.push(next));

  return { seen, fixed };
}

describe("signing an agent in again from a failed run", () => {
  test("checks, then signs in when the agent still needs it", async () => {
    expect(await steps("signedOut")).toEqual({
      seen: [{ step: "checking" }, { step: "signingIn" }, { step: "done" }],
      fixed: ["claude"],
    });
  });

  test("an agent signed in elsewhere since the run is done without signing in", async () => {
    expect(await steps("ready")).toEqual({
      seen: [{ step: "checking" }, { step: "done" }],
      fixed: [],
    });
  });

  test("a sign-in that doesn't finish offers its command for Terminal", async () => {
    const { seen } = await steps("signedOut", { ok: false, command: "claude auth login" });

    expect(seen.at(-1)).toEqual({ step: "failed", command: "claude auth login" });
  });

  test("never installs or updates in its place", async () => {
    for (const state of ["missing", "outdated"] as const) {
      const { seen, fixed } = await steps(state);

      expect(fixed).toEqual([]);
      expect(seen.at(-1)).toEqual({ step: "failed", command: "claude auth login --claudeai" });
    }
  });

  test("a check that fails still leaves the command", async () => {
    const { seen, fixed } = await steps(new Error("sidecar down"));

    expect(fixed).toEqual([]);
    expect(seen.at(-1)).toEqual({ step: "failed", command: "claude auth login --claudeai" });
  });
});
