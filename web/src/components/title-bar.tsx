import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { BackForward } from "@/components/back-forward";
import { Hint } from "@/components/editor/hint";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { useSidebar } from "@/components/ui/sidebar-provider";
import { cn } from "@/lib/utils";

import { desktop, insetTitleBar } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { MOD_KEY } from "../lib/edit-commands.ts";

const Slot = createContext<HTMLElement | null>(null);

/**
 * The bar atop the content, then the content: the sidebar toggle, and room the open view fills
 * with its title and actions through {@link InTitleBar}. On macOS it is the window's title bar,
 * across the whole window above the sidebar and the content: it drags the window, the toggle sits
 * by the window controls, and the title lines up with the content as the sidebar opens and closes.
 */
export function TitleBar({ children }: { children: ReactNode }) {
  const t = useMessages();
  const { state } = useSidebar();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  // The desktop app's back and forward buttons, as a browser's are, then the sidebar toggle.
  const controls = (
    <div className="flex items-center gap-0.5">
      {desktop ? <BackForward /> : null}
      <Hint label={t.nav.toggle} keys={`${MOD_KEY}B`}>
        <SidebarTrigger aria-label={t.nav.toggle} />
      </Hint>
    </div>
  );

  return (
    <Slot value={slot}>
      <header
        data-slot="title-bar"
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 pr-6",
          !insetTitleBar
            ? "pl-4"
            : cn(
                "fixed inset-x-0 top-0 z-20 transition-all duration-200 ease-linear [-webkit-app-region:drag]",
                // Over the open content's own padding (the 14rem sidebar, then 1.5rem), or past the
                // window controls, the buttons and the divider.
                state === "collapsed" ? "pl-52" : "pl-62",
              ),
        )}
      >
        {insetTitleBar ? (
          // A short, faint line level with the title: over the open sidebar's edge, or just past
          // the buttons.
          <div
            aria-hidden
            className={cn(
              "absolute top-4 h-4 w-px bg-border transition-all duration-200 ease-linear",
              state === "collapsed" ? "left-49" : "left-56",
            )}
          />
        ) : (
          controls
        )}
        <div ref={setSlot} className="@container/title flex min-w-0 flex-1 items-center gap-2" />
        {/* Last in the bar, so the area it keeps from dragging is not dragged again over it. */}
        {insetTitleBar ? <div className="fixed top-2.5 left-24 z-20">{controls}</div> : null}
      </header>
      {children}
    </Slot>
  );
}

/** Puts a view's title and actions in the title bar. */
export function InTitleBar({ children }: { children: ReactNode }) {
  const slot = use(Slot);

  return slot === null ? null : createPortal(children, slot);
}
