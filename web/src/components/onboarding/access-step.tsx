import { useEffect, useEffectEvent, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import type { CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { DONE_PAUSE_MS, StepActions, StepDone, StepHeader } from "./frame.tsx";

/**
 * Full Disk Access: why, then one button that opens the list with the app ready to drag into it.
 * It moves on by itself once macOS reports the access, and passes on its own when it is granted
 * already. It can be skipped; macOS then asks per folder.
 */
export function AccessStep({
  onboarding,
  onDone,
}: {
  onboarding: CutfacOnboarding;
  onDone: () => void;
}) {
  const t = useMessages().onboarding.access;
  const [granted, setGranted] = useState(false);
  const [waiting, setWaiting] = useState(false);

  // Once granted it stays so: a check that started before the grant can't take it back.
  const check = useEffectEvent(() => {
    onboarding.fullDiskAccess().then(
      (ok) => {
        if (ok) setGranted(true);
      },
      () => undefined,
    );
  });

  useEffect(() => {
    check();
    addEventListener("focus", check);

    return () => removeEventListener("focus", check);
  }, []);

  useEffect(() => onboarding.onAccessGranted(() => setGranted(true)), [onboarding]);

  const done = useEffectEvent(onDone);

  useEffect(() => {
    if (!granted) return;

    const timer = setTimeout(done, DONE_PAUSE_MS);

    return () => clearTimeout(timer);
  }, [granted]);

  const open = () => {
    setWaiting(true);
    onboarding.openAccessSettings().catch((cause: Error) => {
      setWaiting(false);
      toast.error(cause.message);
    });
  };

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <ol className="flex flex-col gap-3 rounded-2xl bg-muted p-4 text-sm">
        {t.howTo.map((line, index) => (
          <li key={line} className="flex gap-3">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background text-xs font-medium tabular-nums">
              {index + 1}
            </span>
            {line}
          </li>
        ))}
      </ol>
      {granted ? (
        <StepDone label={t.granted} />
      ) : (
        <StepActions>
          <Button size="lg" variant={waiting ? "outline" : "default"} onClick={open}>
            {t.open}
          </Button>
          {waiting ? (
            <p className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
              <Spinner className="size-3" />
              {t.waiting}
            </p>
          ) : null}
          <Button variant="ghost" onClick={onDone}>
            {t.skip}
          </Button>
          <p className="text-center text-xs text-muted-foreground">{t.skipNote}</p>
        </StepActions>
      )}
    </>
  );
}
