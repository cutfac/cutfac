import type { AgentSetup } from "../src/core/agentReadiness.ts";
import { AGENTS, type AgentName } from "../src/core/schema.ts";
import type { DevFakes } from "../web/src/desktop.ts";

type Fixable = Exclude<AgentSetup["state"], "ready">;

export const NO_FAKES: DevFakes = {
  agents: { claude: "real", codex: "real" },
  fixesFail: false,
  access: "real",
  freshFolder: true,
  sharing: "real",
};

const VERB: Record<Fixable, string> = {
  missing: "install",
  outdated: "update",
  signedOut: "sign in to",
};

/** Whether an agent is left to the real check, which runs every CLI and so takes a moment. */
export const checksAgents = (fakes: DevFakes) =>
  AGENTS.some((agent) => fakes.agents[agent] === "real");

/** The fix a faked agent offers. The step shows it to copy when the fix fails; running it is harmless. */
export const fakeFix = (agent: AgentName, state: Fixable) =>
  `echo "Dev Panel: pretend to ${VERB[state]} ${agent}"`;

/** What a faked fix prints as it goes, as an installer would. */
export const fakeFixLines = (agent: AgentName, state: Fixable) => [
  `Pretending to ${VERB[state]} ${agent}…`,
  "Still going…",
  "Almost there…",
];

function fakeSetup(agent: AgentName, state: AgentSetup["state"]): AgentSetup {
  if (state === "ready") return { agent, state, version: "9.9.9" };

  if (state === "missing") return { agent, state, fix: fakeFix(agent, state) };

  return {
    agent,
    state,
    version: state === "outdated" ? "0.0.1" : "9.9.9",
    fix: fakeFix(agent, state),
  };
}

/** The agents as the step finds them: the real check's, with each faked one swapped in. */
export function withFakes(
  real: ReadonlyArray<AgentSetup>,
  fakes: DevFakes["agents"],
): ReadonlyArray<AgentSetup> {
  return AGENTS.flatMap((agent) => {
    const fake = fakes[agent];

    return fake === "real"
      ? real.filter((setup) => setup.agent === agent)
      : [fakeSetup(agent, fake)];
  });
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A new folder name for each run, in local time, sortable by when it was made. */
export const freshFolderName = (now: Date) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
  `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
