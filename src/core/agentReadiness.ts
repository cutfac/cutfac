import { Schema } from "effect";

import { AgentName } from "./schema.ts";

/**
 * Where an agent CLI stands on this machine, as the first launch checks it before there is a
 * workspace: missing, too old, signed out, or ready to run.
 */
export const AgentReadiness = Schema.Literals(["missing", "outdated", "signedOut", "ready"]);

export type AgentReadiness = typeof AgentReadiness.Type;

export const AgentSetup = Schema.Struct({
  agent: AgentName,
  state: AgentReadiness,
  /** The release the CLI reports, when it is installed and says. */
  version: Schema.optional(Schema.String),
  /** What to run in the user's shell to move it toward ready; none when it is ready. */
  fix: Schema.optional(Schema.String),
});

export type AgentSetup = typeof AgentSetup.Type;

/** The agents as `cutfac agents --json` prints them, for the desktop app to read. */
export const AgentSetupJson = Schema.fromJsonString(Schema.Array(AgentSetup));
