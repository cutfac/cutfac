import type { ReactNode } from "react";

import type { Permission } from "../../desktop.ts";
import { useMessages } from "../../i18n/index.ts";
import { showsAfterReopen } from "../../lib/access.ts";

/**
 * How to turn a permission on, in the order the user does it: the list the button opens, the app's
 * switch in it, the + under the list when macOS hasn't put the app there, and reopening the app
 * where the permission shows only after it.
 */
export function AccessGuide({
  permission,
  list,
  app,
}: {
  permission: Permission;
  list: string;
  app: { icon: string; name: string } | undefined;
}) {
  const t = useMessages().onboarding.access.how;

  const badge = (
    <span className="inline-flex items-baseline gap-1 font-medium text-foreground">
      {app === undefined ? null : <img src={app.icon} alt="" className="size-3.5 self-center" />}
      {app?.name ?? "Cutfac"}
    </span>
  );

  const steps: ReadonlyArray<ReactNode> = [
    t.open(list),
    t.switchOn(badge),
    t.add(badge),
    ...(showsAfterReopen(permission) ? [t.reopen] : []),
  ];

  return (
    <ol className="flex flex-col gap-2 rounded-xl bg-background p-3">
      {steps.map((step, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- the steps never reorder
        <li key={index} className="flex gap-2.5 text-xs text-pretty text-muted-foreground">
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-foreground/8 text-xs font-medium text-foreground tabular-nums">
            {index + 1}
          </span>
          <span className="min-w-0 flex-1">{step}</span>
        </li>
      ))}
    </ol>
  );
}
