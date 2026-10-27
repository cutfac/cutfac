import { ArrowUpIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/**
 * The panel that sits under System Settings, after PermissionFlow's: the whole panel is one card,
 * the app to drag into the System Settings list above it, which drags the app itself. It shimmers
 * and glows gold so it is easy to find beside the window, and goes away by itself once the access
 * is granted.
 */
export function DragHelper({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages();
  const [app, setApp] = useState<{ icon: string; name: string }>();

  useEffect(() => {
    onboarding.appIcon().then(setApp, () => undefined);
  }, [onboarding]);

  return (
    <div className="h-dvh p-1.5">
      {app === undefined ? null : (
        // oxlint-disable-next-line jsx-a11y/no-static-element-interactions -- dragged with the mouse, as in Finder; the words on it say so
        <div
          draggable
          className="relative flex h-full animate-access-glow cursor-grab items-center gap-3 overflow-hidden rounded-2xl bg-foreground/6 pr-2 pl-3 transition-colors duration-300 hover:bg-foreground/10 active:cursor-grabbing motion-reduce:animate-none"
          // macOS shows the grab cursor only once the panel takes the pointer.
          onPointerEnter={() => onboarding.focusDragHelper()}
          onDragStart={(event) => {
            // The app drags its own bundle instead of the card.
            event.preventDefault();
            onboarding.startAppDrag();
          }}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 left-0 w-1/3 animate-access-shine bg-linear-to-r from-transparent via-foreground/12 to-transparent motion-reduce:hidden"
          />
          <img src={app.icon} alt="" draggable={false} className="size-10 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{app.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {t.onboarding.dragHelper.hint}
            </span>
          </div>
          <ArrowUpIcon className="size-5 shrink-0 animate-bounce text-brand motion-reduce:animate-none" />
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t.common.close}
            className="shrink-0"
            onClick={() => window.close()}
          >
            <XIcon />
          </Button>
        </div>
      )}
    </div>
  );
}
