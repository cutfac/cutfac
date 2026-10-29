import { CopyIcon, LogInIcon } from "lucide-react";
import { useState, type ReactNode } from "react";

import { SelectionArea } from "@/components/selection-area";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { SIGN_IN_COMMAND } from "../../../../src/core/agentReadiness.ts";
import type { AgentName } from "../../api.ts";
import { desktop } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { type SignIn, signIn } from "../../lib/agent-sign-in.ts";
import { copyText } from "../../lib/clipboard.ts";

/**
 * A run the agent turned down because it isn't signed in, or its sign-in stopped working, and the
 * way back: the desktop app signs it in from here, and the board in a browser gives the command.
 * When signing in from here fails too, the problem may be Cutfac's, so `report` shows.
 */
export function SignInAgain({
  agent,
  error,
  report,
}: {
  agent: AgentName;
  error: string | undefined;
  report: ReactNode;
}) {
  const t = useMessages();
  const copy = t.signIn;
  const onboarding = desktop?.onboarding;

  const [state, setState] = useState<SignIn>(
    onboarding === undefined
      ? { step: "failed", command: SIGN_IN_COMMAND[agent] }
      : { step: "offered" },
  );

  const busy = state.step === "checking" || state.step === "signingIn";

  return (
    <>
      <Bubble variant="destructive">
        <BubbleContent>
          <div className="flex flex-col gap-2">
            <p className="font-medium">{copy.title(t.setup.agents[agent])}</p>
            <p>{copy.body}</p>
            {error === undefined ? null : (
              <SelectionArea render={<p className="text-xs opacity-80" />}>{error}</SelectionArea>
            )}
            {state.step === "failed" ? (
              <Command
                intro={onboarding === undefined ? copy.terminal : copy.failed}
                command={state.command}
              />
            ) : state.step === "done" ? (
              <p className="text-foreground">{copy.done}</p>
            ) : busy ? (
              <span className="flex items-center gap-1.5 text-muted-foreground">
                <Spinner className="size-3" />
                {state.step === "checking" ? copy.checking : copy.signingIn}
              </span>
            ) : onboarding === undefined ? null : (
              <div>
                <Button size="sm" onClick={() => void signIn(onboarding, agent, setState)}>
                  <LogInIcon data-icon="inline-start" />
                  {copy.action}
                </Button>
              </div>
            )}
          </div>
        </BubbleContent>
      </Bubble>
      {state.step === "failed" && onboarding !== undefined ? report : null}
    </>
  );
}

function Command({ intro, command }: { intro: string; command: string }) {
  const t = useMessages();

  return (
    <>
      <p>{intro}</p>
      <SelectionArea
        render={
          <code className="rounded-2xl bg-background/60 px-2.5 py-2 font-mono text-xs break-all text-foreground" />
        }
      >
        {command}
      </SelectionArea>
      <div>
        <Button variant="outline" size="sm" onClick={() => copyText(command, t.signIn.copied)}>
          <CopyIcon data-icon="inline-start" />
          {t.common.copy}
        </Button>
      </div>
    </>
  );
}
