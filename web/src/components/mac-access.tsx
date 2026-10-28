import { MonitorIcon } from "lucide-react";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { desktop, type CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { AccessRows, useAccess } from "./onboarding/access-rows.tsx";

/**
 * On the empty board, while screen recording or accessibility is off, as after skipping them on the
 * first launch: one button that opens the next one to turn on. It goes once both are on.
 */
export function AccessRow() {
  const onboarding = desktop?.onboarding;

  return onboarding === undefined ? null : <AccessReminder onboarding={onboarding} />;
}

function AccessReminder({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages().onboarding.access;
  const access = useAccess(onboarding);

  if (access.allGranted || access.next === undefined) return null;

  const next = access.next;

  return (
    <div className="flex w-full items-center gap-3 rounded-2xl bg-muted py-2.5 pr-2.5 pl-4 text-start text-sm">
      {access.waiting === undefined ? (
        <MonitorIcon className="size-4 shrink-0 text-muted-foreground" />
      ) : (
        <Spinner className="size-4 shrink-0" />
      )}
      <span className="min-w-0 flex-1">
        {access.waiting === undefined ? t.remind : access.copy[access.waiting].waiting}
      </span>
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => access.open(next)}>
        {t.turnOn}
      </Button>
    </div>
  );
}

/** In Settings, both permissions with whether each is on, to turn on whichever was skipped. */
export function MacAccessCard() {
  const onboarding = desktop?.onboarding;

  return onboarding === undefined ? null : <MacAccessSection onboarding={onboarding} />;
}

function MacAccessSection({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages().onboarding.access;
  const access = useAccess(onboarding);

  return (
    <Section title={t.settingsTitle} description={t.body}>
      <div className="py-4">
        <AccessRows access={access} />
      </div>
    </Section>
  );
}
