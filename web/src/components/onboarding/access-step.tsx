import { CheckIcon, MonitorIcon, PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Permission } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { AccessPreview } from "./access-preview.tsx";
import { DONE_PAUSE_MS, StepActions, StepDone, StepHeader } from "./frame.tsx";

const PERMISSIONS: ReadonlyArray<Permission> = ["screen", "accessibility"];

/** A permission as its row and the picture name it. */
interface Copy {
  name: string;
  why: string;
  waiting: string;
  list: string;
}

/** From this macOS on, accessibility is Device Control and Data Access, wider than before. */
const DEVICE_CONTROL_FROM = 27;

/**
 * Screen recording and accessibility, which the agents act under: recording the user's screen and
 * apps as footage, and using other apps when asked, so they can do either from the first video on.
 * Each opens its list in System Settings with the app ready to drag into it. Accessibility shows as
 * soon as it is on; screen recording shows once the app reopens, which macOS offers itself, and the
 * step picks up again then, with the answers kept. It moves on once both are on, and can be
 * skipped; macOS then asks when an agent first needs either.
 */
export function AccessStep({
  onboarding,
  onDone,
  onBack,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
  onBack: () => void;
}) {
  const t = useMessages().onboarding.access;
  const [granted, setGranted] = useState<Partial<Record<Permission, true>>>({});
  const [waiting, setWaiting] = useState<Permission>();
  const [app, setApp] = useState<{ icon: string; name: string }>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
    onboarding.systemVersion().then(setVersion, () => undefined);
  }, [onboarding]);

  // Once granted it stays so: a check that started before the grant can't take it back.
  const grant = (permission: Permission) =>
    setGranted((current) => ({ ...current, [permission]: true }));

  const check = useEffectEvent(() => {
    for (const permission of PERMISSIONS) {
      onboarding.permission(permission).then(
        (ok) => {
          if (ok) grant(permission);
        },
        () => undefined,
      );
    }
  });

  useEffect(() => {
    check();
    addEventListener("focus", check);

    return () => removeEventListener("focus", check);
  }, []);

  useEffect(
    () =>
      onboarding.onAccessGranted((permission) =>
        setGranted((current) => ({ ...current, [permission]: true })),
      ),
    [onboarding],
  );

  const done = useEffectEvent(onDone);
  const allGranted = PERMISSIONS.every((permission) => granted[permission]);

  useEffect(() => {
    if (!allGranted) return;

    const timer = setTimeout(done, DONE_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [allGranted]);

  const open = (permission: Permission) => {
    setWaiting(permission);
    onboarding.openAccessSettings(permission).catch((cause: Error) => {
      setWaiting(undefined);
      toast.error(cause.message);
    });
  };

  const deviceControl = version >= DEVICE_CONTROL_FROM;

  const copy: Record<Permission, Copy> = {
    screen: t.screen,
    accessibility: deviceControl
      ? { ...t.accessibility, name: t.deviceControl, list: t.deviceControl }
      : t.accessibility,
  };

  const icons = {
    screen: <MonitorIcon className="size-4" />,
    accessibility: <PointerIcon className="size-4" />,
  } satisfies Record<Permission, ReactNode>;

  // The picture shows the list the user is on, or the next one to turn on.
  const next = PERMISSIONS.find((permission) => !granted[permission]);
  const shown = waiting ?? next ?? "screen";

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <div className="flex flex-col gap-4 rounded-2xl bg-muted p-4">
        <AccessPreview app={app} list={copy[shown].list} />
        <ul className="flex flex-col gap-3">
          {PERMISSIONS.map((permission) => {
            const on = granted[permission] === true;
            const opened = waiting === permission && !on;

            return (
              <Row
                key={permission}
                icon={icons[permission]}
                name={copy[permission].name}
                why={opened ? copy[permission].waiting : copy[permission].why}
                waiting={opened}
                done={on}
                primary={permission === next && !opened}
                onTurnOn={() => open(permission)}
              />
            );
          })}
        </ul>
      </div>
      {allGranted ? (
        <StepDone label={t.granted} />
      ) : (
        <StepActions onBack={onBack}>
          <Button size="lg" variant="ghost" onClick={onDone}>
            {t.skip}
          </Button>
        </StepActions>
      )}
    </>
  );
}

/** One permission: what it is, what it lets the agent do, and its button, or that it is on. */
function Row({
  icon,
  name,
  why,
  waiting,
  done,
  primary,
  onTurnOn,
}: {
  icon: ReactNode;
  name: string;
  why: string;
  waiting: boolean;
  done: boolean;
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
          {t.on}
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
