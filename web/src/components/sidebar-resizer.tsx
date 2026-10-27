import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import { clampSidebarWidth, SIDEBAR_WIDTH } from "../hooks.ts";
import { useMessages } from "../i18n/index.ts";

/** How far an arrow key moves the edge. */
const STEP = 16;

/** What carries the width the sidebar and the content beside it read. */
const wrapper = (event: { currentTarget: Element }) =>
  event.currentTarget.closest<HTMLElement>('[data-slot="sidebar-wrapper"]');

/**
 * The sidebar's right edge, which drags to set its width. A drag moves the edge on the page
 * directly and saves the width once it is let go, so the board doesn't re-render on every move.
 * A double-click puts the width back.
 */
export function SidebarResizer({
  width,
  onWidth,
}: {
  width: number;
  onWidth: (width: number) => void;
}) {
  const t = useMessages();
  const drag = useRef<{ x: number; width: number; next: number }>(undefined);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width, next: width };
    // The sidebar follows the pointer without its open and close animation.
    wrapper(event)?.setAttribute("data-resizing", "");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;
    drag.current.next = clampSidebarWidth(drag.current.width + event.clientX - drag.current.x);
    wrapper(event)?.style.setProperty("--sidebar-width", `${drag.current.next}px`);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current === undefined) return;
    wrapper(event)?.removeAttribute("data-resizing");
    onWidth(drag.current.next);
    drag.current = undefined;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = { ArrowLeft: -STEP, ArrowRight: STEP }[event.key];

    if (step === undefined) return;

    event.preventDefault();
    onWidth(clampSidebarWidth(width + step));
  };

  return (
    <div
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an hr can't take the hit area and its line
      role="separator"
      aria-orientation="vertical"
      aria-label={t.nav.resize}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => onWidth(SIDEBAR_WIDTH)}
      onKeyDown={onKeyDown}
      // Wide enough to catch, centered on the edge, and drawn as a hairline only while pointed at,
      // dragged or focused.
      className="absolute inset-y-0 right-0 z-20 w-2 translate-x-1/2 cursor-col-resize outline-none group-data-[collapsible=icon]:hidden after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:transition-colors hover:after:bg-border focus-visible:after:bg-ring active:after:bg-border"
    />
  );
}
