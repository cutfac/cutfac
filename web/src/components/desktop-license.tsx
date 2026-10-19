import { useEffect, useState } from "react";
import { toast } from "sonner";

import { LicenseKeyForm } from "@/components/license-key-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacDesktop, LicenseLock } from "../desktop.ts";
import { useLocale, useMessages } from "../i18n/index.ts";
import { CUSTOMER_PORTAL_URL, TRIAL_URL, pricingUrl } from "../lib/license.ts";

type Action = "trial" | "plans" | "key" | "check";

/** The ways out of each lock. The last is the likeliest, so it gets the primary button. */
const ACTIONS: Record<LicenseLock, readonly Action[]> = {
  missing: ["plans", "key", "trial"],
  invalid: ["plans", "key"],
  ended: ["key", "check", "plans"],
  offline: ["key", "check"],
};

interface DesktopLicenseProps {
  desktop: CutfacDesktop;
}

/**
 * The desktop app's license: a lock screen over the board while the app is locked, and the key
 * dialog that the app menu, update checks and the lock screen open.
 */
export function DesktopLicense({ desktop }: DesktopLicenseProps) {
  const [lock, setLock] = useState<LicenseLock>();
  const [entering, setEntering] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let pushed = false;

    const stop = desktop.onLicenseLock((next) => {
      pushed = true;
      setLock(next);
    });

    // A lock pushed while this asked is newer than its answer.
    void desktop.licenseLock().then((next) => {
      if (!pushed) setLock(next);
    });

    return stop;
  }, [desktop]);

  useEffect(
    () =>
      desktop.onLicenseKeyRequest((hasKey) => {
        setSaved(hasKey);
        setEntering(true);
      }),
    [desktop],
  );

  return (
    <Dialog
      open={entering || lock !== undefined}
      // Closing the key form while locked goes back to the lock screen, which never closes.
      onOpenChange={(open) => {
        if (!open) setEntering(false);
      }}
      disablePointerDismissal={lock !== undefined}
    >
      <DialogContent showCloseButton={lock === undefined}>
        {entering || lock === undefined ? (
          <LicenseKeyForm desktop={desktop} saved={saved} onSaved={() => setEntering(false)} />
        ) : (
          <LockScreen
            desktop={desktop}
            lock={lock}
            onEnterKey={() => {
              setSaved(lock !== "missing");
              setEntering(true);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface LockScreenProps {
  desktop: CutfacDesktop;
  lock: LicenseLock;
  onEnterKey: () => void;
}

/** Why the app is locked, and the way out: a trial, a plan, a key, or another check. */
function LockScreen({ desktop, lock, onEnterKey }: LockScreenProps) {
  const t = useMessages();
  const locale = useLocale();
  const [checking, setChecking] = useState(false);
  const actions = ACTIONS[lock];

  function checkAgain() {
    setChecking(true);
    desktop
      .recheckLicense()
      .then((next) => {
        // A lift or a new reason shows on its own; only an unchanged answer needs saying.
        if (next === lock) {
          toast.warning(lock === "offline" ? t.licenseLock.stillOffline : t.licenseLock.stillEnded);
        }
      })
      .catch((cause: Error) => toast.error(cause.message))
      .finally(() => setChecking(false));
  }

  function button(action: Action) {
    const variant = action === actions.at(-1) ? "default" : "outline";

    if (action === "key") {
      return (
        <Button key={action} variant={variant} onClick={onEnterKey}>
          {t.licenseLock.enterKey}
        </Button>
      );
    }

    if (action === "check") {
      return (
        <Button key={action} variant={variant} disabled={checking} onClick={checkAgain}>
          {checking ? <Spinner data-icon="inline-start" /> : null}
          {checking ? t.license.checking : t.licenseLock.checkAgain}
        </Button>
      );
    }

    return (
      <Button
        key={action}
        variant={variant}
        nativeButton={false}
        render={
          // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
          <a
            href={action === "trial" ? TRIAL_URL : pricingUrl(locale)}
            target="_blank"
            rel="noopener noreferrer"
          />
        }
      >
        {action === "trial" ? t.licenseLock.startTrial : t.licenseLock.seePlans}
      </Button>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t.licenseLock[lock].title}</DialogTitle>
        <DialogDescription>
          {t.licenseLock[lock].description((text) => (
            <a href={CUSTOMER_PORTAL_URL} target="_blank" rel="noopener noreferrer">
              {text}
            </a>
          ))}
        </DialogDescription>
      </DialogHeader>
      <p className="text-xs text-muted-foreground">{t.licenseLock.openSource}</p>
      <DialogFooter>{actions.map((action) => button(action))}</DialogFooter>
    </>
  );
}
