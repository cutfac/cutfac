import type { AgentChoice, AgentName, AgentStatus } from "../api.ts";
import type { AgentSetup } from "../desktop.ts";
import type { RunStep } from "./run.ts";

/**
 * The agent that makes the first template: the workspace default when it is ready, else the
 * first one that is. None when no agent is ready, which the agent step doesn't let happen.
 */
export function onboardingAgent(
  preferred: AgentChoice | undefined,
  setups: ReadonlyArray<AgentSetup>,
): AgentName | undefined {
  const ready = setups.flatMap((setup) => (setup.state === "ready" ? [setup.agent] : []));

  return preferred !== undefined && preferred !== "queue" && ready.includes(preferred)
    ? preferred
    : ready[0];
}

/**
 * The agents a new workspace connects without asking: every one installed and recent enough that
 * isn't connected yet. One signed out connects too, since signing in doesn't change the setup.
 */
export const agentsToConnect = (statuses: ReadonlyArray<AgentStatus>): AgentName[] =>
  statuses.flatMap((status) =>
    status.installed && status.outdated === undefined && !status.connected ? [status.agent] : [],
  );

/** How far a template run has come, as one line under the title field says it. */
export type RunPhase = "reading" | "writing" | "checking";

const PHASE_ORDER: ReadonlyArray<RunPhase> = ["reading", "writing", "checking"];

/** Tool names differ by agent: `mcp__cutfac__check_format` in Claude Code, `check_format` in Codex. */
const toolPhase = (name: string): RunPhase => {
  if (name.endsWith("check_format")) return "checking";

  if (name.endsWith("save_format") || /^(write|edit|multiedit)$/i.test(name)) return "writing";

  return "reading";
};

/**
 * The furthest the run got: it reads the brief and the reference, writes the template, then checks
 * it. A fix after a failed check still reads as checking, which is what the user waits on.
 */
export function runPhase(steps: ReadonlyArray<RunStep>): RunPhase {
  let furthest = 0;

  for (const step of steps) {
    if (step.kind === "tool") {
      furthest = Math.max(furthest, PHASE_ORDER.indexOf(toolPhase(step.name)));
    }
  }

  return PHASE_ORDER[furthest] ?? "reading";
}

const skipKey = (root: string) => `cutfac.start.skipped.${root}`;

/**
 * Whether the user set aside the first template for this workspace, so the board stops opening
 * on it. Kept in this browser: it is a nudge, not part of the workspace.
 */
export function startSkipped(root: string): boolean {
  try {
    return localStorage.getItem(skipKey(root)) !== null;
  } catch {
    return false;
  }
}

export function skipStart(root: string): void {
  try {
    localStorage.setItem(skipKey(root), "1");
  } catch {
    // Storage can be blocked; the board then opens on the first template again next time.
  }
}

/**
 * Whether a workspace opened with no page in mind starts on its first template: it has none, no
 * brief either, and the user hasn't set it aside.
 */
export const needsStart = (formats: number, briefExists: boolean, skipped: boolean) =>
  formats === 0 && !briefExists && !skipped;
