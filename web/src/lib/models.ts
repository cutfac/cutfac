import { Array, Option } from "effect";

import type { AgentChoice, AgentName, AgentStatus, ModelSettings } from "../api.ts";
import type { Messages } from "../i18n/index.ts";

/** The model and effort picked for each agent; one left out runs on the agent's own default. */
export type ModelPicks = Partial<Record<AgentName, ModelSettings>>;

const LABELS: Record<AgentName, string> = { claude: "Claude", codex: "Codex" };

export const AGENTS: ReadonlyArray<{ agent: AgentName; label: string }> = (
  ["claude", "codex"] as const
).map((agent) => ({ agent, label: LABELS[agent] }));

export const agentLabel = (agent: AgentName) => LABELS[agent];

/** The agent's product name, or "the agent" while a run has not said which agent it is. */
export const agentTitle = (agent: Option.Option<AgentName>, t: Messages) =>
  Option.match(agent, { onNone: () => t.chat.agent, onSome: agentLabel });

/** The model and effort a run or request names, as the chat shows them. */
export interface NamedSettings {
  readonly model?: string | undefined;
  readonly effort?: string | undefined;
}

/** What the board knows about an agent, once the list has loaded. */
export const statusOf = (statuses: ReadonlyArray<AgentStatus> | undefined, agent: AgentChoice) =>
  Array.findFirst(statuses ?? [], (status) => status.agent === agent);

/** The efforts to offer: the picked model's, or those that suit whatever model the agent picks. */
export function effortsFor(status: AgentStatus, model: string | undefined) {
  const picked = status.models.find((option) => option.id === model);

  return picked?.efforts ?? status.efforts;
}

/** Whether the agent offers anything to pick, so the picker is worth showing. */
const offersModels = (status: AgentStatus) => status.models.length > 0 || status.efforts.length > 0;

/** The effort to run with when none is picked: Medium, else the model's own, else the middle one. */
function defaultEffort(
  efforts: ReadonlyArray<string>,
  own: Option.Option<string>,
): Option.Option<string> {
  if (efforts.includes("medium")) return Option.some("medium");

  const offered = Option.filter(own, (effort) => efforts.includes(effort));

  return Option.isSome(offered) ? offered : Array.get(efforts, Math.floor(efforts.length / 2));
}

/**
 * What a request is sent with: the pick, with a model and effort the agent offers filled in where
 * it has none or no longer offers it, so the picker always names what runs. The model filled in is
 * the agent's first listed, its newest, rather than whatever its own config names. With no list to
 * check against, nothing is picked.
 */
export function usableSettings(
  status: Option.Option<AgentStatus>,
  pick: ModelSettings | undefined,
): ModelSettings {
  const offering = Option.filter(status, offersModels);

  if (Option.isNone(offering)) return {};

  const { models } = offering.value;

  const option = Array.findFirst(models, (candidate) => candidate.id === pick?.model).pipe(
    Option.orElse(() => Array.head(models)),
  );

  const model = Option.map(option, ({ id }) => id);
  const efforts = effortsFor(offering.value, Option.getOrUndefined(model));

  const effort = Option.filter(Option.fromUndefinedOr(pick?.effort), (picked) =>
    efforts.includes(picked),
  ).pipe(
    Option.orElse(() =>
      defaultEffort(
        efforts,
        Option.flatMap(option, (picked) => Option.fromUndefinedOr(picked.defaultEffort)),
      ),
    ),
  );

  return {
    ...Option.match(model, { onNone: () => ({}), onSome: (id) => ({ model: id }) }),
    ...Option.match(effort, { onNone: () => ({}), onSome: (level) => ({ effort: level }) }),
  };
}

/** The settings picked for `agent`, as a request to it is sent; a prompt to copy has none. */
export const pickedSettings = (
  statuses: ReadonlyArray<AgentStatus> | undefined,
  picks: ModelPicks,
  agent: AgentChoice,
): ModelSettings =>
  agent === "queue" ? {} : usableSettings(statusOf(statuses, agent), picks[agent]);

/** A model's name as its agent lists it, or its id when the list does not have it. */
const modelLabel = (status: Option.Option<AgentStatus>, model: string) =>
  Option.flatMap(status, ({ models }) => Array.findFirst(models, ({ id }) => id === model)).pipe(
    Option.match({ onNone: () => model, onSome: ({ label }) => label }),
  );

/** An effort in the user's language, or as the agent names it when the board has no word for it. */
export const effortLabel = (effort: string, t: Messages) =>
  Object.entries(t.composer.models.efforts).find(([key]) => key === effort)?.[1] ?? effort;

/** The model and effort a run or request names, such as `Opus` and `High`; none for defaults. */
export function settingsLabels(
  status: Option.Option<AgentStatus>,
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
  agent: Option.Option<AgentName>,
  settings: NamedSettings,
  statuses: ReadonlyArray<AgentStatus> | undefined,
  t: Messages,
) =>
  [
    agentTitle(agent, t),
    ...settingsLabels(
      Option.flatMap(agent, (named) => statusOf(statuses, named)),
      settings,
      t,
    ),
  ].join(" · ");
