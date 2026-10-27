import type { AgentName, AgentStatus } from "../api.ts";

/**
 * The agents a new workspace connects without asking: every one installed and recent enough that
 * isn't connected yet. One signed out connects too, since signing in doesn't change the setup.
 */
export const agentsToConnect = (statuses: ReadonlyArray<AgentStatus>): AgentName[] =>
  statuses.flatMap((status) =>
    status.installed && status.outdated === undefined && !status.connected ? [status.agent] : [],
  );

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
