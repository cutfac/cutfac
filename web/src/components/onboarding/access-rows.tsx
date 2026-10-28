import { CheckIcon, MonitorIcon, PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Permission } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { sendFailed } from "../../lib/notify.ts";

export const PERMISSIONS: ReadonlyArray<Permission> = ["screen", "accessibility"];

/** A permission as its row and the picture name it. */
interface Copy {
  name: string;
  why: string;
  waiting: string;
  list: string;
}

/** From this macOS on, accessibility is Device Control and Data Access, wider than before. */
const DEVICE_CONTROL_FROM = 27;

const ICONS = {
  screen: <MonitorIcon className="size-4" />,
  accessibility: <PointerIcon className="size-4" />,
} satisfies Record<Permission, ReactNode>;

export interface Access {
  granted: Partial<Record<Permission, true>>;
  /** The one whose list in System Settings the user was sent to and hasn't turned on yet. */
  waiting: Permission | undefined;
  /** The next one to turn on. */
  next: Permission | undefined;
  allGranted: boolean;
  copy: Record<Permission, Copy>;
  app: { icon: string; name: string } | undefined;
  open: (permission: Permission) => void;
}

/**
 * Screen recording and accessibility as macOS has them for the app, checked again whenever the
 * window comes back, with a way to open each one's list in System Settings and the app ready to
 * drag into it. The first launch asks for both; the board and Settings offer them again.
 */
export function useAccess(onboarding: CutfacOnboarding): Access {
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

  const open = (permission: Permission) => {
    setWaiting(permission);
    onboarding.openAccessSettings(permission).catch((cause) => {
      setWaiting(undefined);
      sendFailed(cause);
    });
  };

  const copy: Record<Permission, Copy> = {
    screen: t.screen,
    accessibility:
      version >= DEVICE_CONTROL_FROM
        ? { ...t.accessibility, name: t.deviceControl, list: t.deviceControl }
        : t.accessibility,
  };

  const next = PERMISSIONS.find((permission) => !granted[permission]);

  return {
    granted,
    waiting: waiting !== undefined && !granted[waiting] ? waiting : undefined,
    next,
    allGranted: next === undefined,
    copy,
    app,
    open,
  };
}

/** Both permissions, each with what it lets the agent do and its button, or that it is on. */
export function AccessRows({ access }: { access: Access }) {
  return (
    <ul className="flex flex-col gap-3">
      {PERMISSIONS.map((permission) => {
        const opened = access.waiting === permission;

        return (
          <Row
            key={permission}
            icon={ICONS[permission]}
            name={access.copy[permission].name}
            why={opened ? access.copy[permission].waiting : access.copy[permission].why}
            waiting={opened}
            done={access.granted[permission] === true}
            primary={permission === access.next && !opened}
            onTurnOn={() => access.open(permission)}
          />
        );
      })}
    </ul>
  );
}

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
