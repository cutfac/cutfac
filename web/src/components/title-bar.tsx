import { createContext, use, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Hint } from "@/components/editor/hint";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

import { insetTitleBar } from "../desktop.ts";
import { useMessages } from "../i18n/index.ts";
import { MOD_KEY } from "../lib/edit-commands.ts";

/**
 * The sidebar's share of the macOS title bar: empty, under the window controls, and dragging the
 * window like a title bar does. Nothing in a browser or on other systems.
 */
export function TitleBarStrip() {
  if (!insetTitleBar) return null;

  return <div aria-hidden="true" className="h-12 shrink-0 [-webkit-app-region:drag]" />;
}

const Slot = createContext<HTMLElement | null>(null);

/**
 * The bar atop the content, then the content: the sidebar toggle, and room the open view fills
 * with its title and actions through {@link InTitleBar}. On macOS it is the window's title bar: it
 * drags the window, and the toggle sits by the window controls and stays there as the sidebar
 * opens and closes.
 */
export function TitleBar({ children }: { children: ReactNode }) {
  const t = useMessages();
  const { state } = useSidebar();
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  const toggle = (
    <Hint label={t.nav.toggle} keys={`${MOD_KEY}B`}>
      <SidebarTrigger aria-label={t.nav.toggle} />
    </Hint>
  );

  return (
    <Slot value={slot}>
      <header
        data-slot="title-bar"
        className={cn(
          "flex h-12 shrink-0 items-center gap-2 pr-6",
          !insetTitleBar
            ? "pl-4"
            : // Clear the window controls and the toggle while the sidebar is too narrow to.
              cn(
                "transition-all duration-200 ease-linear [-webkit-app-region:drag]",
                state === "collapsed" ? "pl-19" : "pl-6",
              ),
        )}
      >
        {insetTitleBar ? null : toggle}
        <div ref={setSlot} className="flex min-w-0 flex-1 items-center gap-2" />
        {/* Last in the bar, so the area it keeps from dragging is not dragged again over it. */}
        {insetTitleBar ? <div className="fixed top-2.5 left-21 z-20">{toggle}</div> : null}
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
