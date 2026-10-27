import { ArrowUpIcon, HandIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/**
 * The panel that sits under System Settings, after PermissionFlow's: a sentence pointing up at the
 * Full Disk Access list, and the app as a card to drag into it, which drags the app itself. The
 * panel moves by its background, and goes away by itself once the access is granted.
 */
export function DragHelper({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages();
  const [app, setApp] = useState<{ icon: string; name: string }>();

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
  }, [onboarding]);

  return (
    <div className="flex h-dvh flex-col gap-2.5 p-3 [-webkit-app-region:drag]">
      <div className="flex items-start gap-2">
        <ArrowUpIcon className="mt-0.5 size-4 shrink-0 animate-bounce text-brand" />
        <p className="flex-1 text-sm/snug text-pretty">
          {t.onboarding.dragHelper.title(app?.name ?? "Cutfac")}
        </p>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t.common.close}
          className="-mt-0.5 [-webkit-app-region:no-drag]"
          onClick={() => window.close()}
        >
          <XIcon />
        </Button>
      </div>
      {app === undefined ? null : (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dragged with the mouse, as in Finder; the sentence above says so
        <div
          draggable
          className="flex animate-in cursor-grab items-center gap-3 rounded-2xl bg-foreground/6 py-2 pr-3 pl-2 transition-colors duration-300 [-webkit-app-region:no-drag] fade-in hover:bg-foreground/10 active:cursor-grabbing"
          onDragStart={(event) => {
            // The app drags its own bundle instead of the card.
            event.preventDefault();
            onboarding.startAppDrag();
          }}
        >
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
