import { SelectionArea } from "@/components/selection-area";

import type { AgentStatus } from "../api.ts";
import { useMessages } from "../i18n/index.ts";

/**
 * Says an agent's CLI is older than Cutfac supports and how to update it. Nothing when it is
 * current, or when the version is unknown.
 */
export function OutdatedAgentNote({
  status,
  className,
}: {
  status: AgentStatus;
  className?: string;
}) {
  const t = useMessages();
  const { outdated, version } = status;

  if (outdated === undefined || version === undefined) return null;

  return (
    <SelectionArea render={<p className={className} />}>
      {t.setup.agentOutdated(
        t.setup.agents[status.agent],
        version,
        outdated.minimum,
        <code className="font-mono">{outdated.update}</code>,
      )}
    </SelectionArea>
  );
}
