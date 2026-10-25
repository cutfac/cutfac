import { ShieldQuestionIcon } from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

import type { Approval, ApprovalAnswer } from "../../approvalsApi.ts";
import { useMessages } from "../../i18n/index.ts";
import { sendFailed } from "../../lib/notify.ts";

/** Answer what the agent asks; resolves once the answer reached the server. */
export type OnAnswer = (approval: Approval, answer: ApprovalAnswer) => Promise<void>;

/**
 * What the agent asks before it uses a tool, with the answers its own prompt gives in a terminal.
 * The run waits on it; it goes once the run says the request is settled.
 */
export function ApprovalCard({
  approval,
  agent,
  onAnswer,
}: {
  approval: Approval;
  /** The agent's name, as the board shows it. */
  agent: string;
  onAnswer: OnAnswer;
}) {
  const t = useMessages();
  const [busy, setBusy] = useState(false);

  const answer = (choice: ApprovalAnswer) => {
    setBusy(true);
    // An answer that didn't go through leaves the request to answer again.
    onAnswer(approval, choice).catch((cause: unknown) => {
      setBusy(false);
      sendFailed(cause);
    });
  };

  return (
    <Alert>
      <ShieldQuestionIcon />
      <AlertTitle>{approval.title ?? t.approval.asks(agent, approval.tool)}</AlertTitle>
      <AlertDescription className="mt-1">
        <div className="flex flex-col gap-2.5">
          {approval.detail === undefined ? null : (
            <pre className="max-h-40 overflow-y-auto rounded-lg bg-muted px-2.5 py-2 font-mono text-xs break-all whitespace-pre-wrap text-foreground">
              {approval.detail}
            </pre>
          )}
          {approval.reason === undefined ? null : <div>{approval.reason}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => answer("allow")}>
              {t.approval.allow}
            </Button>
            {approval.always ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => answer("always")}
                    />
                  }
                >
                  {t.approval.always}
                </TooltipTrigger>
                <TooltipContent>{t.approval.keeps(agent, approval.rules)}</TooltipContent>
              </Tooltip>
            ) : null}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => answer("deny")}>
              {t.approval.deny}
            </Button>
          </div>
        </div>
      </AlertDescription>
    </Alert>
  );
}
