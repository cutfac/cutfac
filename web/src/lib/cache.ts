import type { AgentChoice, AgentName, AgentStatus, ItemDetail, ModelSettings } from "../api.ts";
import { ownModel } from "./models.ts";

/**
 * A pick the agent's cached conversation cannot carry over, so it reads the whole conversation
 * again on the next request. A model left out is the agent's default.
 */
export type CacheNotice =
  | { readonly kind: "model"; readonly model: string | undefined }
  | { readonly kind: "effort"; readonly effort: string };

/** The settings the agent's conversation on the item was last asked for, and the run it made. */
function lastAsked(item: ItemDetail, agent: AgentName) {
  for (const feedback of item.doc.feedback.toReversed()) {
    // Lined up, it runs before the next request does.
    if (feedback.waiting === agent) return { settings: feedback, run: undefined };

    if (feedback.run?.agent === agent) return { settings: feedback.run, run: feedback.run };
  }

  return undefined;
}

/**
 * Whether sending with `settings` makes the agent read its conversation on the item again, as
 * Claude Code and Codex warn when a model changes mid-conversation. A change of effort alone says
 * so only when the agent said it cannot keep the cache through one.
 */
export function cacheNotice(
  item: ItemDetail,
  agent: AgentChoice,
  settings: ModelSettings,
  status: AgentStatus | undefined,
): CacheNotice | undefined {
  if (agent === "queue" || status === undefined) return undefined;

  if (item.doc.sessions?.[agent] === undefined) return undefined;
  const last = lastAsked(item, agent);

  if (last === undefined) return undefined;
  const model = settings.model ?? ownModel(status);
  const before = last.settings.model ?? ownModel(status);

  // A run that named no model ran the agent's default, which may be any model when it does not say.
  if (before === undefined) return undefined;

  if (model !== before) return { kind: "model", model };
  const option = status.models.find((candidate) => candidate.id === model);
  const effort = settings.effort ?? option?.defaultEffort;

  if (effort === undefined || effort === (last.settings.effort ?? option?.defaultEffort)) {
    return undefined;
  }

  const keeps = last.run?.effortKeepsCache ?? option?.effortKeepsCache;

  return keeps === false ? { kind: "effort", effort } : undefined;
}
