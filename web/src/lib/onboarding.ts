import { Array, Option, Schema } from "effect";

import { AgentName as AgentNameSchema } from "../../../src/core/schema.ts";
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

/** A website as typed, with `https://` added when it is left out, such as `yourwebsite.com`. */
export const asWebsite = (typed: string) => {
  const text = typed.trim();

  return text === "" || text.includes("://") ? text : `https://${text}`;
};

/**
 * A name for the first workspace from the website the user gave, as its address reads without
 * `www.`, such as `cutfac.com`; none without one.
 */
export const nameFromSources = (sources: ReadonlyArray<string>): Option.Option<string> =>
  Array.findFirst(sources, (source) => {
    const text = source.trim();

    return urlOf(asWebsite(text)).pipe(
      Option.map(({ hostname }) => hostname),
      Option.filter((hostname) => hostname.includes(".")),
      Option.map((hostname) => hostname.replace(/^www\./, "")),
    );
  });

/** The first workspace's name: the website's address, else the default the board names. */
export const suggestedName = (sources: ReadonlyArray<string>, fallback: string) =>
  Option.getOrElse(nameFromSources(sources), () => fallback);

const AGENT_KEY = "cutfac.onboarding.agent";

const decodeAgent = Schema.decodeUnknownOption(AgentNameSchema);

/** The agent the user picked on the first launch to make their videos with, if they did. */
export const pickedAgent = (): Option.Option<AgentName> =>
  Option.flatMap(Option.fromNullishOr(readStored(AGENT_KEY)), decodeAgent);

export function pickAgent(agent: AgentName): void {
  writeStored(AGENT_KEY, agent);
}

/**
 * The agent the first workspace works with: the one picked when it is ready, else the first ready
 * in the order shown, Claude Code first.
 */
export const workingAgent = (
  ready: ReadonlyArray<AgentName>,
  picked: Option.Option<AgentName>,
): Option.Option<AgentName> =>
  Option.orElse(
    Option.filter(picked, (agent) => ready.includes(agent)),
    () => Array.head(ready),
  );

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
