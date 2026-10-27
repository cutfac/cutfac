import { BellIcon, CheckIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { desktop } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { sendFailed } from "../lib/notify.ts";
import { readStored } from "../lib/storage.ts";

/** Asked notifications already: macOS answers once and doesn't say what, so asking is the step. */
const NOTIFY_KEY = "cutfac.onboarding.notificationsAsked";

const readAsked = () => readStored(NOTIFY_KEY) !== null;

/**
 * Notifications, offered before the first video, when they help: the app says when the agent waits
 * for the user and they are elsewhere. Only the desktop app notifies.
 */
export function NotifyRow() {
  const n = useMessages().start.notify;
  const [asked, setAsked] = useState(readAsked);
  const onboarding = desktop?.onboarding;

  if (onboarding === undefined) return null;

  const turnOn = () => {
    try {
      localStorage.setItem(NOTIFY_KEY, "1");
    } catch {
      // The row just offers it again after a reload.
    }

    setAsked(true);
    onboarding.askNotifications(n.sample).catch(sendFailed);
  };

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl bg-muted py-2.5 pr-2.5 pl-4 text-start text-sm">
      <BellIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">{n.label}</span>
      {asked ? (
        <span className="flex shrink-0 items-center gap-1 pr-1.5 text-xs font-medium">
          <CheckIcon className="size-3.5" />
          {n.done}
        </span>
      ) : (
        <Button size="sm" variant="outline" className="shrink-0" onClick={turnOn}>
          {n.turnOn}
        </Button>
      )}
    </div>
  );
}
