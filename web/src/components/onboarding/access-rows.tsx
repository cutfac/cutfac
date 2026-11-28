import { CheckIcon, MonitorIcon, PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Permission } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { accessProgress, PERMISSIONS, type Granted } from "../../lib/access.ts";
import { sendFailed } from "../../lib/notify.ts";

/** A permission as its row names it. */
interface Copy {
  name: string;
  why: string;
}

/** From this macOS on, accessibility is Device Control and Data Access, wider than before. */
const DEVICE_CONTROL_FROM = 27;

const ICONS = {
  screen: <MonitorIcon className="size-4" />,
  accessibility: <PointerIcon className="size-4" />,
} satisfies Record<Permission, ReactNode>;

export interface Access {
  granted: Granted;
  /** The one whose list in System Settings the user was sent to and hasn't turned on yet. */
  waiting: Permission | undefined;
  /** The next one to turn on. */
  next: Permission | undefined;
  allGranted: boolean;
  copy: Record<Permission, Copy>;
  open: (permission: Permission) => void;
}

/**
 * Screen recording and accessibility as macOS has them for the app, checked again whenever the
 * window comes back, with a way to open each one's list in System Settings and have macOS ask for
 * it. The first launch asks for both; the board and Settings offer them again.
 */
export function useAccess(onboarding: CutfacOnboarding): Access {
  const t = useMessages().onboarding.access;
  const [granted, setGranted] = useState<Granted>({});
  const [opened, setOpened] = useState<Permission>();
  const [version, setVersion] = useState(0);

  useEffect(() => {
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
    setOpened(permission);
    onboarding.openAccessSettings(permission).catch((cause) => {
      setOpened(undefined);
      sendFailed(cause);
    });
  };

  const copy: Record<Permission, Copy> = {
    screen: t.screen,
    accessibility:
      version >= DEVICE_CONTROL_FROM
        ? { ...t.accessibility, name: t.deviceControl }
        : t.accessibility,
  };

  return {
    granted,
    ...accessProgress(granted, opened),
    copy,
    open,
  };
}

/** Both permissions, each with what it lets the agent do and its button, or that it is on. */
export function AccessRows({ access }: { access: Access }) {
  const t = useMessages().onboarding.access;

  return (
    <ul className="flex flex-col gap-3">
      {PERMISSIONS.map((permission) => {
        const opened = access.waiting === permission;

        return (
          <Row
            key={permission}
            icon={ICONS[permission]}
            name={access.copy[permission].name}
            why={opened ? t.waiting : access.copy[permission].why}
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
