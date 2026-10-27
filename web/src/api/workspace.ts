import { Schema } from "effect";

import { AgentName, WorkspaceConfig } from "../../../src/core/schema.ts";
import { Ok, request, send } from "./client.ts";
import { Format } from "./library.ts";

export { AgentChoice, AgentName, AgentRun, ModelSettings } from "../../../src/core/schema.ts";

export const WorkspaceInfo = Schema.Struct({
  name: Schema.String,
  root: Schema.String,
  config: WorkspaceConfig,
  formats: Schema.Array(Format),
  openFeedback: Schema.Finite,
});

export type WorkspaceInfo = typeof WorkspaceInfo.Type;

/**
 * Which Cutfac serves the board: the open-source version, which has no limit, or the desktop app,
 * on a paid plan or its free version with the videos it has made on this Mac.
 */
export const Plan = Schema.Union([
  Schema.Struct({ edition: Schema.Literal("open-source") }),
  Schema.Struct({ edition: Schema.Literal("desktop"), paid: Schema.Literal(true) }),
  Schema.Struct({
    edition: Schema.Literal("desktop"),
    paid: Schema.Literal(false),
    used: Schema.Finite,
    limit: Schema.Finite,
  }),
]);

export type Plan = typeof Plan.Type;

/** A model the board offers for an agent, and the efforts it takes. */
export const ModelOption = Schema.Struct({
  /** What the agent CLI takes, such as `opus`. */
  id: Schema.String,
  label: Schema.String,
  efforts: Schema.Array(Schema.String),
  defaultEffort: Schema.optionalKey(Schema.String),
  /** Whether a change of effort alone keeps the agent's prompt cache; left out when unknown. */
  effortKeepsCache: Schema.optionalKey(Schema.Boolean),
});

export type ModelOption = typeof ModelOption.Type;

export const AgentStatus = Schema.Struct({
  agent: AgentName,
  installed: Schema.Boolean,
  connected: Schema.Boolean,
  models: Schema.Array(ModelOption),
  /** The efforts that suit whatever model the agent picks itself. */
  efforts: Schema.Array(Schema.String),
  /** The name of the model the agent runs when none is picked, such as `Sonnet 5`, if known. */
  defaultModel: Schema.optionalKey(Schema.String),
  /** The release the agent's CLI reports, if it does. */
  version: Schema.optionalKey(Schema.String),
  /** Set when that release is older than Cutfac supports: the oldest one that is, and how to update. */
  outdated: Schema.optionalKey(Schema.Struct({ minimum: Schema.String, update: Schema.String })),
});

export type AgentStatus = typeof AgentStatus.Type;

const AgentConnection = Schema.Struct({
  agent: AgentName,
  ok: Schema.Boolean,
  detail: Schema.String,
});

export type AgentConnection = typeof AgentConnection.Type;

/** A setting the workspace has Claude Code act on by itself, or a whole file that is not JSON. */
export const TrustItem = Schema.Union([
  Schema.Struct({ file: Schema.String, key: Schema.String, value: Schema.Json }),
  Schema.Struct({ file: Schema.String, value: Schema.String }),
]);

export type TrustItem = typeof TrustItem.Type;

/** Whether Claude waits for the user to trust the workspace's settings before it runs. */
export const TrustStatus = Schema.Struct({
  needed: Schema.Boolean,
  items: Schema.Array(TrustItem),
  /** Names exactly these settings; trusting it doesn't trust ones changed since. */
  fingerprint: Schema.String,
});

export type TrustStatus = typeof TrustStatus.Type;

/**
 * Whether this build can send error reports and usage statistics, what the person chose for each,
 * and this install's ID.
 */
export const ErrorReports = Schema.Struct({
  available: Schema.Boolean,
  /** Null until the person chooses. */
  errorReports: Schema.NullOr(Schema.Boolean),
  usageStats: Schema.NullOr(Schema.Boolean),
  installId: Schema.NullOr(Schema.String),
});

export type ErrorReports = typeof ErrorReports.Type;

/** What to send the Cutfac team; a choice left out stays as it was. */
export interface ReportChoices {
  errorReports?: boolean;
  usageStats?: boolean;
}

/** What a person tells the people who make Cutfac, from the board's dialog or a `/feedback` message. */
export interface TeamFeedback {
  message: string;
  /** Where the team can reply; left out to stay anonymous. */
  email?: string;
  source: "board" | "slash";
  platform: string;
  locale: string;
  /** The agent the person works with; left out, the server names the workspace's default. */
  agent?: AgentName;
  /** Send the desktop app's recent log with it, which the person agreed to. */
  logs?: boolean;
}

const TeamFeedbackLogs = Schema.Struct({
  logs: Schema.NullOr(Schema.String),
  errors: Schema.Finite,
});

export const workspaceApi = {
  health: () => request(Ok, "/api/health"),
  workspace: () => request(WorkspaceInfo, "/api/workspace"),
  plan: () => request(Plan, "/api/plan"),
  agents: () => request(Schema.Array(AgentStatus), "/api/agents"),
  connectAgent: (agent: AgentName) =>
    send(AgentConnection, "POST", "/api/agents/connect", { agent }),
  trust: () => request(TrustStatus, "/api/trust"),
  trustWorkspace: (fingerprint: string) => send(TrustStatus, "POST", "/api/trust", { fingerprint }),
  /** Feedback for the Cutfac team, which the server passes on to cutfac.com. */
  teamFeedback: (feedback: TeamFeedback) => send(Ok, "POST", "/api/team-feedback", feedback),
  /**
   * The log feedback would carry, for the person to read first, and how many errors it holds;
   * no log outside the desktop app.
   */
  teamFeedbackLogs: () => request(TeamFeedbackLogs, "/api/team-feedback/logs"),
  errorReports: () => request(ErrorReports, "/api/error-reports"),
  setReportChoices: (choices: ReportChoices) =>
    send(ErrorReports, "POST", "/api/error-reports", choices),
  /** How the first launch went: counted only while the person shares usage statistics. */
  onboardingFinished: (went: { screen_recording: boolean; accessibility: boolean }) =>
    send(Ok, "POST", "/api/usage/onboarding-finished", went),
  resetInstallId: () => send(ErrorReports, "POST", "/api/error-reports/install-id", {}),
};
