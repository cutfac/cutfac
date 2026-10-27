import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import { useSidebar } from "@/components/ui/sidebar";

import { clampSidebarWidth, SIDEBAR_WIDTH } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** How far an arrow key moves the edge. */
const STEP = 16;

/** The folded sidebar's width, its row of icons. */
const ICON_WIDTH = 48;

/**
 * Below this the sidebar folds to its icons, as a Mac app's does. It sits well under the narrowest
 * width, so a drag that only means to make the sidebar narrow stops there and doesn't fold it.
 */
const FOLD_BELOW = 120;

/** What carries the width the sidebar and the content beside it read. */
const wrapper = (event: { currentTarget: Element }) =>
  event.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');

/** Where the edge lands for a drag to `to`: folded (undefined), or open at a width it can take. */
const land = (to: number) => (to < FOLD_BELOW ? undefined : clampSidebarWidth(to));

/**
 * The sidebar's right edge, which drags to set its width. Dragged far enough left it folds the
 * sidebar to its icons, and dragged back out it opens it again. A drag moves the edge on the page
 * directly and saves the width once it is let go, so the board doesn't re-render on every move.
 * A double-click opens the sidebar at its usual width.
 */
export function SidebarResizer({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (width: number) => void;
}) {
  const t = useMessages();
  const { open, setOpen } = useSidebar();
  const drag = useRef<{ x: number; from: number; next: number | undefined }>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX,
      from: open ? width : ICON_WIDTH,
      next: open ? width : undefined,
    };
    // The sidebar follows the pointer without its open and close animation.
    wrapper(event)?.setAttribute("data-resizing", "");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;

    const next = land(drag.current.from + event.clientX - drag.current.x);

    // Folding and opening go through the sidebar's state, only as the drag crosses the line.
    if ((next === undefined) !== (drag.current.next === undefined)) setOpen(next !== undefined);

    drag.current.next = next;

    if (next !== undefined) wrapper(event)?.style.setProperty("--sidebar-width", `${next}px`);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;

    const element = wrapper(event);

    element?.removeAttribute("data-resizing");

    // Folded, it keeps the width it had, for when it opens again.
    if (drag.current.next === undefined)
      element?.style.setProperty("--sidebar-width", `${width}px`);
    else onWidth(drag.current.next);

    drag.current = undefined;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -STEP, ArrowRight: STEP }[event.key];

    if (step === undefined) return;

    event.preventDefault();

    if (!open) {
      if (step > 0) setOpen(true);

      return;
    }

    // An arrow past the narrowest width folds it, as a drag that far does.
    if (clampSidebarWidth(width + step) > width + step) setOpen(false);
    else onWidth(clampSidebarWidth(width + step));
  };

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an hr can't take the hit area and its line
      role="separator"
      aria-orientation="vertical"
      aria-label={t.nav.resize}
      aria-valuenow={open ? width : ICON_WIDTH}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => {
        onWidth(SIDEBAR_WIDTH);
        setOpen(true);
      }}
      onKeyDown={onKeyDown}
      // Wide enough to catch, centered on the edge, and drawn as a hairline only while pointed at,
      // dragged or focused.
      className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-border focus-visible:after:bg-ring active:after:bg-border"
    />
  );
}
