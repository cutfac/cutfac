import type { AgentChoice, AgentStatus, ItemDetail, ModelSettings } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import { cacheNotice } from "../../lib/cache.ts";
import { effortLabel, modelLabel } from "../../lib/models.ts";

/**
 * Says that the picked model or effort makes the agent read this item's conversation again on the
 * next request, as Claude Code and Codex do on a switch. Nothing when the pick keeps the cache.
 */
export function CacheNote({
  item,
  agent,
  settings,
  status,
}: {
  item: ItemDetail;
  agent: AgentChoice;
  settings: ModelSettings;
  status: AgentStatus | undefined;
}) {
  const t = useMessages();
  const m = t.composer.models;
  const notice = cacheNotice(item, agent, settings, status);

  if (notice === undefined) return null;

  const text =
    notice.kind === "effort"
      ? m.cacheEffort(effortLabel(notice.effort, t))
      : m.cacheModel(
          notice.model === undefined
            ? (status?.defaultModel ?? m.defaultModel)
            : modelLabel(status, notice.model),
        );

  return <p className="px-1 text-xs text-muted-foreground">{text}</p>;
}
