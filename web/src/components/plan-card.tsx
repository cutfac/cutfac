import { Option } from "effect";
import type { ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

import type { Plan } from "../api.ts";
import { desktop } from "../desktop.ts";
import { useLocale, useMessages } from "../i18n/index.ts";
import { downloadUrl, freeVersion, pricingUrl } from "../lib/license.ts";

/** cutfac.com's plans, opened in the browser. */
export function UpgradeButton(props: Pick<ComponentProps<typeof Button>, "size">) {
  const t = useMessages();
  const locale = useLocale();

  return (
    <Button
      {...props}
      nativeButton={false}
      render={
        // oxlint-disable-next-line jsx-a11y/control-has-associated-label -- the label is the button's children
        <a href={pricingUrl(locale)} target="_blank" rel="noopener noreferrer" />
      }
    >
      {t.plan.upgrade}
    </Button>
  );
}

/**
 * Which Cutfac this is, at the foot of the sidebar: how many videos the desktop app's free version
 * has made, with a way to upgrade, or a quiet pointer from the open-source version to the desktop
 * app. Nothing on a paid plan.
 */
export function PlanCard({ plan }: { plan: Plan | undefined }) {
  const t = useMessages();
  const locale = useLocale();
  const free = freeVersion(plan);

  // The desktop app run from source serves an open-source board, which needs no pointer to itself.
  if (plan?.edition === "open-source" && !desktop) {
    return (
      <p className="px-2 text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        {t.plan.openSource} ·{" "}
        <a
          href={downloadUrl(locale)}
          target="_blank"
          rel="noopener noreferrer"
          className="underline-offset-4 hover:text-foreground hover:underline"
        >
          {t.plan.getDesktop}
        </a>
      </p>
    );
  }

  if (Option.isNone(free)) return null;

  const { used, limit } = free.value;
  const usage = t.plan.used(used, limit);

  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-3 text-card-foreground group-data-[collapsible=icon]:hidden">
      <div className="grid gap-1.5">
        <div className="grid gap-0.5">
          <p className="text-sm font-medium">{t.plan.freeTitle}</p>
          <p className="text-xs text-muted-foreground">{usage}</p>
        </div>
        <Progress
          aria-label={t.plan.freeTitle}
          value={used}
          max={limit}
          getAriaValueText={() => usage}
        />
      </div>
      <div className="grid gap-1">
        <UpgradeButton size="sm" />
        {desktop ? (
          <Button variant="ghost" size="xs" onClick={() => desktop?.requestLicenseKey()}>
            {t.plan.enterKey}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
