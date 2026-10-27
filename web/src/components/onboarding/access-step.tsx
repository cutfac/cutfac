import { BellIcon, CheckIcon, MonitorIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { AccessPreview } from "./access-preview.tsx";
import { DONE_PAUSE_MS, StepActions, StepDone, StepHeader } from "./frame.tsx";

/** Asked notifications already: macOS answers once and doesn't say what, so asking is the step. */
const NOTIFICATIONS_KEY = "cutfac.onboarding.notificationsAsked";

function readAsked(): boolean {
  try {
    return localStorage.getItem(NOTIFICATIONS_KEY) !== null;
  } catch {
    return false;
  }
}

function writeAsked() {
  try {
    localStorage.setItem(NOTIFICATIONS_KEY, "1");
  } catch {
    // The step just asks again after a reload.
  }
}

/**
 * Notifications and screen recording. Notifications let the app say when a render finishes or an
 * agent waits; macOS asks on the first one, so Turn on puts up a sample. Screen recording lets the
 * agents record the user's screen and apps as footage, and is granted on a list in System Settings,
 * opened with the app ready to drag into it. It shows once the app reopens, which macOS offers
 * itself, and the step picks up again then. It moves on once both are done, and can be skipped.
 */
export function AccessStep({
  onboarding,
  onDone,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
}) {
  const t = useMessages().onboarding.access;
  const [asked, setAsked] = useState(readAsked);
  const [screen, setScreen] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [app, setApp] = useState<{ icon: string; name: string }>();

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
  }, [onboarding]);

  // Once granted it stays so: a check that started before the grant can't take it back.
  const check = useEffectEvent(() => {
    onboarding.permission("screen").then(
      (ok) => {
        if (ok) setScreen(true);
      },
      () => undefined,
    );
  });

  useEffect(() => {
    check();
    addEventListener("focus", check);

    return () => removeEventListener("focus", check);
  }, []);

  useEffect(() => onboarding.onAccessGranted(() => setScreen(true)), [onboarding]);

  const done = useEffectEvent(onDone);
  const allDone = asked && screen;

  useEffect(() => {
    if (!allDone) return;

    const timer = setTimeout(done, DONE_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [allDone]);

  const askNotifications = () => {
    writeAsked();
    setAsked(true);
    onboarding.askNotifications(t.notifications.sample).catch((cause: Error) => {
      toast.error(cause.message);
    });
  };

  const openScreen = () => {
    setWaiting(true);
    onboarding.openAccessSettings("screen").catch((cause: Error) => {
      setWaiting(false);
      toast.error(cause.message);
    });
  };

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <div className="flex flex-col gap-4 rounded-2xl bg-muted p-4">
        <AccessPreview app={app} list={t.screen.list} />
        <ul className="flex flex-col gap-3">
          <Row
            icon={<BellIcon className="size-4" />}
            name={t.notifications.name}
            why={t.notifications.why}
            done={asked}
            doneLabel={t.asked}
            primary={!asked}
            onTurnOn={askNotifications}
          />
          <Row
            icon={<MonitorIcon className="size-4" />}
            name={t.screen.name}
            why={waiting && !screen ? t.screen.waiting : t.screen.why}
            waiting={waiting && !screen}
            done={screen}
            doneLabel={t.on}
            primary={asked && !screen && !waiting}
            onTurnOn={openScreen}
          />
        </ul>
      </div>
      {allDone ? (
        <StepDone label={t.granted} />
      ) : (
        <StepActions>
          <Button variant="ghost" onClick={onDone}>
            {t.skip}
          </Button>
        </StepActions>
      )}
    </>
  );
}

/** One thing to turn on: what it is, what it lets the app do, and its button, or that it is done. */
function Row({
  icon,
  name,
  why,
  waiting = false,
  done,
  doneLabel,
  primary,
  onTurnOn,
}: {
  icon: ReactNode;
  name: string;
  why: string;
  waiting?: boolean;
  done: boolean;
  doneLabel: string;
  primary: boolean;
  onTurnOn: () => void;
}) {
  const t = useMessages().onboarding.access;

  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-background">
        {icon}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{name}</span>
        <span className="flex items-center gap-1.5 text-xs text-pretty text-muted-foreground">
          {waiting ? <Spinner className="size-3 shrink-0" /> : null}
          {why}
        </span>
      </div>
      {done ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
          <CheckIcon className="size-3.5" />
          {doneLabel}
        </span>
      ) : (
        <Button
          size="sm"
          variant={primary ? "default" : "outline"}
          className="shrink-0"
          onClick={onTurnOn}
        >
          {t.turnOn}
        </Button>
      )}
    </li>
  );
}
