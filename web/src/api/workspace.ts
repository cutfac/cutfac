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

export const ModelOption = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  efforts: Schema.Array(Schema.String),
  defaultEffort: Schema.optionalKey(Schema.String),
  effortKeepsCache: Schema.optionalKey(Schema.Boolean),
});

export type ModelOption = typeof ModelOption.Type;

export const AgentStatus = Schema.Struct({
  agent: AgentName,
  installed: Schema.Boolean,
  connected: Schema.Boolean,
  models: Schema.Array(ModelOption),
  efforts: Schema.Array(Schema.String),
  defaultModel: Schema.optionalKey(Schema.String),
  version: Schema.optionalKey(Schema.String),
  outdated: Schema.optionalKey(Schema.Struct({ minimum: Schema.String, update: Schema.String })),
});

export type AgentStatus = typeof AgentStatus.Type;

const AgentConnection = Schema.Struct({
  agent: AgentName,
  ok: Schema.Boolean,
  detail: Schema.String,
});

export type AgentConnection = typeof AgentConnection.Type;

export const TrustItem = Schema.Union([
  Schema.Struct({ file: Schema.String, key: Schema.String, value: Schema.Json }),
  Schema.Struct({ file: Schema.String, value: Schema.String }),
]);

export type TrustItem = typeof TrustItem.Type;

export const TrustStatus = Schema.Struct({
  needed: Schema.Boolean,
  items: Schema.Array(TrustItem),
  fingerprint: Schema.String,
});

export type TrustStatus = typeof TrustStatus.Type;

export const ErrorReports = Schema.Struct({
  available: Schema.Boolean,
  errorReports: Schema.NullOr(Schema.Boolean),
  usageStats: Schema.NullOr(Schema.Boolean),
  installId: Schema.NullOr(Schema.String),
});

export type ErrorReports = typeof ErrorReports.Type;

export interface ReportChoices {
  errorReports?: boolean;
  usageStats?: boolean;
}

export interface TeamFeedback {
  message: string;
  email?: string;
  source: "board" | "slash";
  platform: string;
  locale: string;
  agent?: AgentName;
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
  teamFeedback: (feedback: TeamFeedback) => send(Ok, "POST", "/api/team-feedback", feedback),
  teamFeedbackLogs: () => request(TeamFeedbackLogs, "/api/team-feedback/logs"),
  errorReports: () => request(ErrorReports, "/api/error-reports"),
  setReportChoices: (choices: ReportChoices) =>
    send(ErrorReports, "POST", "/api/error-reports", choices),
  onboardingFinished: (went: { screen_recording: boolean; accessibility: boolean }) =>
    send(Ok, "POST", "/api/usage/onboarding-finished", went),
  resetInstallId: () => send(ErrorReports, "POST", "/api/error-reports/install-id", {}),
};
