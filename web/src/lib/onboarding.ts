import { Array, Option } from "effect";

import type { AgentName, AgentStatus } from "../api.ts";
import { readStored, writeStored } from "./storage.ts";
import { urlOf } from "./utils.ts";

/**
 * The agents a new workspace connects without asking: every one installed and recent enough that
 * isn't connected yet. One signed out connects too, since signing in doesn't change the setup.
 */
export const agentsToConnect = (statuses: ReadonlyArray<AgentStatus>): AgentName[] =>
  statuses.flatMap((status) =>
    status.installed && status.outdated === undefined && !status.connected ? [status.agent] : [],
  );

/**
 * A name for the first workspace from the website the user gave, as its address reads without
 * `www.`, such as `cutfac.com`; none without one.
 */
export const nameFromSources = (sources: ReadonlyArray<string>): Option.Option<string> =>
  Array.findFirst(sources, (source) => {
    const text = source.trim();

    return urlOf(text.includes("://") ? text : `https://${text}`).pipe(
      Option.map(({ hostname }) => hostname),
      Option.filter((hostname) => hostname.includes(".")),
      Option.map((hostname) => hostname.replace(/^www\./, "")),
    );
  });

/** The first workspace's name: the website's address, else the default the board names. */
export const suggestedName = (sources: ReadonlyArray<string>, fallback: string) =>
  Option.getOrElse(nameFromSources(sources), () => fallback);

const skipKey = (root: string) => `cutfac.start.skipped.${root}`;

/**
 * Whether the user set aside the first template for this workspace, so the board stops opening
 * on it. Kept in this browser: it is a nudge, not part of the workspace.
 */
export const startSkipped = (root: string) => readStored(skipKey(root)) !== null;

export function skipStart(root: string): void {
  writeStored(skipKey(root), "1");
}

/**
 * Whether a workspace opened with no page in mind starts on its first template: it has none, no
 * brief either, and the user hasn't set it aside.
 */
export const needsStart = (formats: number, briefExists: boolean, skipped: boolean) =>
  formats === 0 && !briefExists && !skipped;
