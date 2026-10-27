import { CheckIcon, MonitorIcon, PointerIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding, Permission } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { AccessPreview } from "./access-preview.tsx";
import { DONE_PAUSE_MS, StepActions, StepDone, StepHeader } from "./frame.tsx";

const PERMISSIONS: ReadonlyArray<Permission> = ["screen", "accessibility"];

const ICONS = { screen: MonitorIcon, accessibility: PointerIcon } satisfies Record<
  Permission,
  typeof MonitorIcon
>;

/**
 * Screen recording and accessibility, which the agents act under: recording the screen for videos,
 * and using other apps. Each opens its list in System Settings with the app ready to drag into it.
 * Accessibility shows as soon as it is on; screen recording shows once the app reopens, which macOS
 * offers itself, and the step picks up again then. It moves on once both are on, and can be
 * skipped; macOS then asks when an agent first needs either.
 */
export function AccessStep({
  onboarding,
  onDone,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
}) {
  const t = useMessages().onboarding.access;
  const [granted, setGranted] = useState<Partial<Record<Permission, true>>>({});
  const [waiting, setWaiting] = useState<Permission>();
  const [app, setApp] = useState<{ icon: string; name: string }>();

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
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

  // The picture shows the list the user is on, or the next one to turn on.
  const next = PERMISSIONS.find((permission) => !granted[permission]);
  const shown = waiting ?? next ?? "screen";

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <div className="flex flex-col gap-4 rounded-2xl bg-muted p-4">
        <AccessPreview app={app} list={t.permissions[shown].list} />
        <ul className="flex flex-col gap-3">
          {PERMISSIONS.map((permission) => (
            <PermissionRow
              key={permission}
              permission={permission}
              granted={granted[permission] === true}
              waiting={waiting === permission}
              primary={permission === next}
              onOpen={() => open(permission)}
            />
          ))}
        </ul>
      </div>
      {allGranted ? (
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

/** A permission, what it lets the agent do, and its button, or that it is on. */
function PermissionRow({
  permission,
  granted,
  waiting,
  primary,
  onOpen,
}: {
  permission: Permission;
  granted: boolean;
  waiting: boolean;
  primary: boolean;
  onOpen: () => void;
}) {
  const t = useMessages().onboarding.access;
  const copy = t.permissions[permission];
  const Icon = ICONS[permission];

  return (
    <li className="flex items-center gap-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-2xl bg-background">
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-sm font-medium">{copy.name}</span>
        <span className="text-xs text-pretty text-muted-foreground">
          {waiting && !granted ? (
            <span className="flex items-center gap-1.5">
              <Spinner className="size-3 shrink-0" />
              {copy.waiting}
            </span>
          ) : (
            copy.why
          )}
        </span>
      </div>
      {granted ? (
        <span className="flex shrink-0 items-center gap-1 text-xs font-medium">
          <CheckIcon className="size-3.5" />
          {t.on}
        </span>
      ) : (
        <Button
          size="sm"
          variant={primary && !waiting ? "default" : "outline"}
          className="shrink-0"
          onClick={onOpen}
        >
          {t.turnOn}
        </Button>
      )}
    </li>
  );
}
