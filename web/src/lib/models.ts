import type { AgentChoice, AgentName, AgentStatus, ModelSettings } from "../api.ts";
import type { Messages } from "../i18n/index.ts";

/** The model and effort picked for each agent; one left out runs on the agent's own default. */
export type ModelPicks = Partial<Record<AgentName, ModelSettings>>;

export const AGENTS: ReadonlyArray<{ agent: AgentName; label: string }> = [
  { agent: "claude", label: "Claude" },
  { agent: "codex", label: "Codex" },
];

/** The agent's product name, or undefined when a run has not said which agent it is. */
export const agentLabel = (agent: AgentName | undefined) =>
  AGENTS.find((entry) => entry.agent === agent)?.label;

/** The model and effort a run or request names, as the chat shows them. */
export interface NamedSettings {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

/** What the board knows about an agent, once the list has loaded. */
export const statusOf = (
  statuses: ReadonlyArray<AgentStatus> | undefined,
  agent: AgentChoice | undefined,
) => statuses?.find((status) => status.agent === agent);

/** The efforts to offer: the picked model's, or those that suit whatever model the agent picks. */
export function effortsFor(status: AgentStatus, model: string | undefined) {
  const picked = status.models.find((option) => option.id === model);

  return picked?.efforts ?? status.efforts;
}

/** Whether the agent offers anything to pick, so the picker is worth showing. */
export const offersModels = (status: AgentStatus | undefined): status is AgentStatus =>
  status !== undefined && (status.models.length > 0 || status.efforts.length > 0);

/**
 * What a request is sent with: the pick, less a model or effort the agent no longer offers. With
 * no list to check against, nothing is picked, so what is sent is what the picker shows.
 */
export function usableSettings(
  status: AgentStatus | undefined,
  pick: ModelSettings | undefined,
): ModelSettings {
  if (!offersModels(status) || pick === undefined) return {};

  const settings: ModelSettings = {};

  const model = status.models.find((option) => option.id === pick.model)?.id;

  if (model !== undefined) settings.model = model;

  if (pick.effort !== undefined && effortsFor(status, settings.model).includes(pick.effort)) {
    settings.effort = pick.effort;
  }

  return settings;
}

/** The settings picked for `agent`, as a request to it is sent; a prompt to copy has none. */
export const pickedSettings = (
  statuses: ReadonlyArray<AgentStatus> | undefined,
  picks: ModelPicks,
  agent: AgentChoice,
): ModelSettings =>
  agent === "queue" ? {} : usableSettings(statusOf(statuses, agent), picks[agent]);

/** A model's name as its agent lists it, or its id when the list does not have it. */
export const modelLabel = (status: AgentStatus | undefined, model: string) =>
  status?.models.find((option) => option.id === model)?.label ?? model;

/** An effort in the user's language, or as the agent names it when the board has no word for it. */
export const effortLabel = (effort: string, t: Messages) =>
  Object.entries(t.composer.models.efforts).find(([key]) => key === effort)?.[1] ?? effort;

/** The model and effort a run or request names, such as `Opus` and `High`; none for defaults. */
export function settingsLabels(
  status: AgentStatus | undefined,
  settings: NamedSettings,
  t: Messages,
) {
  const labels: string[] = [];

  if (settings.model !== undefined) labels.push(modelLabel(status, settings.model));

  if (settings.effort !== undefined) labels.push(effortLabel(settings.effort, t));

  return labels;
}

/** Who answers a message: the agent, with the model and effort when the request picked them. */
export const answerer = (
  agent: AgentName | undefined,
  settings: NamedSettings,
  statuses: ReadonlyArray<AgentStatus> | undefined,
  t: Messages,
) =>
  [
    agentLabel(agent) ?? t.chat.agent,
    ...settingsLabels(statusOf(statuses, agent), settings, t),
  ].join(" · ");
