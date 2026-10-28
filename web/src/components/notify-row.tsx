import { BellIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

import { desktop } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { sendFailed } from "../lib/notify.ts";
import { readStored, writeStored } from "../lib/storage.ts";

/** Asked notifications already: macOS answers once and doesn't say what, so asking is the step. */
const NOTIFY_KEY = "cutfac.onboarding.notificationsAsked";

const readAsked = () => readStored(NOTIFY_KEY) !== null;

/** The same offer as a quiet link, for under what the empty board asks first. */
export function NotifyLink() {
  const n = useMessages().start.notify;
  const [asked, setAsked] = useState(readAsked);
  const onboarding = desktop?.onboarding;

  if (onboarding === undefined || asked) return null;

  const turnOn = () => {
    writeStored(NOTIFY_KEY, "1");
    setAsked(true);
    onboarding.askNotifications(n.sample).catch(sendFailed);
  };

  return (
    <Button size="xs" variant="ghost" onClick={turnOn}>
      <BellIcon data-icon="inline-start" />
      {n.link}
    </Button>
  );
}
