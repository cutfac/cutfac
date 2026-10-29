import { SIGN_IN_COMMAND } from "../../../src/core/agentReadiness.ts";
import type { AgentName } from "../api.ts";
import type { CutfacOnboarding } from "../desktop.ts";

export type SignIn =
  | { readonly step: "offered" | "checking" | "signingIn" | "done" }
  | { readonly step: "failed"; readonly command: string };

/**
 * Signs the agent in from the desktop app. It checks first, since the user may have signed in
 * elsewhere since the run, and runs only a sign-in, never an install or an update.
 */
export function signIn(
  onboarding: Pick<CutfacOnboarding, "agents" | "fixAgent">,
  agent: AgentName,
  update: (next: SignIn) => void,
): Promise<void> {
  const failed = (command: string) => update({ step: "failed", command });

  update({ step: "checking" });

  return onboarding.agents().then(
    async (setups) => {
      const state = setups.find((setup) => setup.agent === agent)?.state;

      if (state === "ready") return update({ step: "done" });

      if (state !== "signedOut") return failed(SIGN_IN_COMMAND[agent]);

      update({ step: "signingIn" });
      const result = await onboarding.fixAgent(agent);

      return result.ok ? update({ step: "done" }) : failed(result.command);
    },
    () => failed(SIGN_IN_COMMAND[agent]),
  );
}
