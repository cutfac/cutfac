import { ArrowRightIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";

import type { CutfacOnboarding } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { AccessRows, useAccess } from "./access-rows.tsx";
import { StepActions, StepHeader } from "./frame.tsx";

/**
 * Screen recording and accessibility, which the agents act under: recording the user's screen and
 * apps as footage, and using other apps when asked, so they can do either from the first video on.
 * Each opens its list in System Settings and has macOS ask for it. Accessibility shows as soon as it is on; screen recording shows once the app
 * reopens, which macOS offers itself, and the step picks up again then, with the answers kept. Once
 * both are on, Next moves on, focused so Enter does too; until then it can be skipped, and macOS
 * asks when an agent first needs either.
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
  const access = useAccess(onboarding);
  const next = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (access.allGranted) next.current?.focus();
  }, [access.allGranted]);

  return (
    <>
      <StepHeader title={t.title} body={t.body} />
      <div className="rounded-2xl bg-muted p-4">
        <AccessRows access={access} />
      </div>
      <StepActions onBack={onBack}>
        {access.allGranted ? (
          <Button ref={next} size="lg" onClick={onDone}>
            {t.next}
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        ) : (
          <Button size="lg" variant="ghost" onClick={onDone}>
            {t.skip}
          </Button>
        )}
      </StepActions>
    </>
  );
}
