import { ArrowUpIcon, HandIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/**
 * The panel that sits under System Settings, after PermissionFlow's: a sentence pointing up at the
 * Full Disk Access list, and the app as a card to drag into it. A drag from anywhere on the panel
 * drags the app itself, never the panel, which follows System Settings on its own. It goes away by
 * itself once the access is granted.
 */
export function DragHelper({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages();
  const [app, setApp] = useState<{ icon: string; name: string }>();

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
  }, [onboarding]);

  return (
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dragged with the mouse, as in Finder; the sentence on it says so
    <div
      draggable={app !== undefined}
      className="group flex h-dvh cursor-grab flex-col gap-2.5 p-3 active:cursor-grabbing"
      onDragStart={(event) => {
        // The app drags its own bundle instead of the page.
        event.preventDefault();
        onboarding.startAppDrag();
      }}
    >
      <div className="flex items-start gap-2">
        <ArrowUpIcon className="mt-0.5 size-4 shrink-0 animate-bounce text-brand" />
        <p className="flex-1 text-sm/snug text-pretty">
          {t.onboarding.dragHelper.title(app?.name ?? "Cutfac")}
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t.common.close}
          className="-mt-0.5"
          onClick={() => window.close()}
        >
          <XIcon />
        </Button>
      </div>
      {app === undefined ? null : (
        <div className="flex animate-in items-center gap-3 rounded-2xl bg-foreground/6 py-2 pr-3 pl-2 transition-colors duration-300 fade-in group-hover:bg-foreground/10">
          <img src={app.icon} alt="" draggable={false} className="size-8" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{app.name}</span>
          <span className="flex shrink-0 flex-col items-center text-muted-foreground">
            <HandIcon className="size-4" />
            <span className="text-xs">{t.onboarding.dragHelper.drag}</span>
          </span>
        </div>
      )}
    </div>
  );
}
