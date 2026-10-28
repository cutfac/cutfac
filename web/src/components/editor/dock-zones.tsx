import { useDroppable } from "@dnd-kit/core";
import { GripVerticalIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useMessages } from "../../i18n/index.ts";
import { chatZoneId, stripZones } from "../../lib/dock-zones.ts";
import { SLOTS, type EditorLayout, type Slot, type StripId } from "../../lib/editor-layout.ts";
import { SLOT_NAME } from "./dock-context.ts";

const BAND: Readonly<Record<Slot, string>> = {
  left: "absolute inset-y-0 left-0 flex w-[22%] flex-col gap-2",
  right: "absolute inset-y-0 right-0 flex w-[22%] flex-col gap-2",
  bottom: "absolute right-[22%] bottom-0 left-[22%] flex h-[30%] gap-2",
};

/** Where a dragged strip can land, over the preview and the strips. */
export function StripZones({
  layout,
  strip,
  width,
}: {
  layout: EditorLayout;
  strip: StripId;
  width: number;
}) {
  const t = useMessages();
  const zones = stripZones(layout, strip, width);

  return (
    <div className="absolute inset-0 z-40 cursor-grabbing">
      {SLOTS.map((slot) => (
        <div key={slot} className={BAND[slot]}>
          {zones
            .filter((zone) => zone.slot === slot)
            .map((zone) => (
              <Zone key={zone.id} id={zone.id} disabled={zone.disabled}>
                {zone.disabled ? t.layout.narrow : t.layout[SLOT_NAME[slot]]}
              </Zone>
            ))}
        </div>
      ))}
    </div>
  );
}

/** Where the dragged chat panel can land: either edge of the editor. */
export function ChatZones() {
  const t = useMessages();

  return (
    <div className="absolute inset-0 z-40 cursor-grabbing">
      <div className="absolute inset-y-0 left-0 flex w-1/4 p-2">
        <Zone id={chatZoneId("left")}>{t.layout.leftEdge}</Zone>
      </div>
      <div className="absolute inset-y-0 right-0 flex w-1/4 p-2">
        <Zone id={chatZoneId("right")}>{t.layout.rightEdge}</Zone>
      </div>
    </div>
  );
}

function Zone({
  id,
  disabled = false,
  children,
}: {
  id: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled });

  return (
    <div
      ref={setNodeRef}
      data-over={isOver}
      data-disabled={disabled || undefined}
      className="flex min-h-0 min-w-0 flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-dock/60 bg-dock/10 p-2 data-[disabled]:opacity-40 data-[over=true]:border-solid data-[over=true]:border-dock data-[over=true]:bg-dock/20"
    >
      <span className="max-w-full truncate rounded-full bg-background px-3 py-1 text-xs font-medium text-dock shadow-sm">
        {children}
      </span>
    </div>
  );
}

/** What follows the pointer while a section is dragged: its name, ending at the grip. */
export function DragChip({ name }: { name: string }) {
  return (
    <div className="relative size-full">
      <div className="absolute inset-y-0 right-0 flex items-center gap-1.5 rounded-full bg-popover px-2.5 text-xs font-medium whitespace-nowrap text-popover-foreground shadow-lg ring-2 ring-dock">
        <GripVerticalIcon className="size-3.5" />
        {name}
      </div>
    </div>
  );
}
