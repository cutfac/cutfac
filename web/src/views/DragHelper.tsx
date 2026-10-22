import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

import type { CutfacOnboarding } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";

/**
 * The small window that floats beside System Settings: the app's icon to drag into the Full Disk
 * Access list, which drags the app itself. The window moves by its background, and goes away by
 * itself once the access is granted.
 */
export function DragHelper({ onboarding }: { onboarding: CutfacOnboarding }) {
  const t = useMessages();
  const [icon, setIcon] = useState<string>();

  useEffect(() => {
    onboarding.appIcon().then(setIcon, () => undefined);
  }, [onboarding]);

  return (
    <div className="relative flex h-dvh flex-col items-center justify-center gap-3 px-5 text-center [-webkit-app-region:drag]">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={t.common.close}
        className="absolute top-2 left-2 [-webkit-app-region:no-drag]"
        onClick={() => window.close()}
      >
        <XIcon />
      </Button>
      <div className="size-16">
        {icon === undefined ? null : (
          // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dragged with the mouse, as in Finder; the text under it says so
          <img
            src={icon}
            alt=""
            className="size-16 animate-in duration-500 zoom-in-90 [-webkit-app-region:no-drag] fade-in"
            onDragStart={(event) => {
              // The app drags its own bundle instead of the picture.
              event.preventDefault();
              onboarding.startAppDrag();
            }}
          />
        )}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-balance">{t.onboarding.dragHelper.title}</p>
        <p className="text-xs/relaxed text-pretty text-muted-foreground">
          {t.onboarding.dragHelper.body}
        </p>
      </div>
    </div>
  );
}
