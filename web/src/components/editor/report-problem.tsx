import { Option } from "effect";
import { MessageSquareWarningIcon } from "lucide-react";
import { useState } from "react";

import { FeedbackDialog } from "@/components/feedback-dialog";
import { Button } from "@/components/ui/button";

import type { AgentName } from "../../api.ts";
import { useMessages } from "../../i18n/index.ts";
import type { Failure } from "../../lib/feedback.ts";
import type { RunView } from "../../lib/run.ts";
import { readStored, writeStored } from "../../lib/storage.ts";

const reportedKey = (startedAt: string) => `cutfac.reported.${startedAt}`;

/**
 * A failed run's way to tell the Cutfac team, which asks more plainly once the item's runs keep
 * failing, and says thanks instead once this run was reported.
 */
export function ReportProblem({ run, agent }: { run: RunView; agent: AgentName }) {
  const t = useMessages();
  const copy = t.teamFeedback;
  // Which run was reported, so a retry that fails in its place can be reported too.
  const [sentFor, setSentFor] = useState<string>();

  const reported = Option.exists(
    run.startedAt,
    (at) => at === sentFor || readStored(reportedKey(at)) !== null,
  );

  if (reported) return <p className="text-xs text-muted-foreground">{copy.reported}</p>;

  const about: Failure = {
    error: Option.getOrElse(run.error, () => t.chat.failed),
    agent,
    model: Option.fromUndefinedOr(run.settings.model),
    inARow: run.failedInARow,
  };

  const keepsFailing = run.failedInARow > 1;

  function markReported() {
    if (Option.isNone(run.startedAt)) return;

    setSentFor(run.startedAt.value);
    writeStored(reportedKey(run.startedAt.value), "1");
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      {keepsFailing ? (
        <p className="text-sm text-muted-foreground">{copy.keepsFailing(run.failedInARow)}</p>
      ) : null}
      <FeedbackDialog
        about={about}
        onSent={markReported}
        trigger={
          <Button variant={keepsFailing ? "outline" : "ghost"} size={keepsFailing ? "sm" : "xs"}>
            <MessageSquareWarningIcon data-icon="inline-start" />
            {copy.reportAction}
          </Button>
        }
      />
    </div>
  );
}
