import { MonitorIcon } from "lucide-react";

import { Section } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

import { desktop, type CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { AccessRows, useAccess } from "./onboarding/access-rows.tsx";

/** The same offer as a quiet link, for under what the empty board asks first. */
export function AccessLink() {
  const onboarding = desktop?.onboarding;

  return onboarding === undefined ? null : <AccessLinkOn onboarding={onboarding} />;
}

function AccessLinkOn({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages().onboarding.access;
  const access = useAccess(onboarding);

  if (access.next === undefined) return null;

  const next = access.next;

  if (access.waiting !== undefined) {
    return (
      <span className="flex items-center gap-1.5 px-2 text-xs text-muted-foreground">
        <Spinner className="size-3" />
        {access.copy[access.waiting].waiting}
      </span>
    );
  }

  return (
    <Button size="xs" variant="ghost" onClick={() => access.open(next)}>
      <MonitorIcon data-icon="inline-start" />
      {t.link}
    </Button>
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
