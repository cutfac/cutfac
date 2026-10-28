import { useDndMonitor, useDraggable } from "@dnd-kit/core";
import { Match, Option, Schema } from "effect";
import { GripVerticalIcon } from "lucide-react";
import { use, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useMessages } from "../../i18n/index.ts";
import type { Section } from "../../lib/dock-zones.ts";
import { updateLayout } from "../../lib/editor-layout-store.ts";
import {
  DEFAULT_LAYOUT,
  fitsIn,
  isDefaultLayout,
  moveChat,
  moveStrip,
  SIDES,
  slotOf,
  SLOTS,
  type EditorLayout,
  type StripId,
} from "../../lib/editor-layout.ts";
import { DockContext, nameOf, SLOT_NAME, type Dock } from "./dock-context.ts";

const decodeSlot = Schema.decodeUnknownOption(Schema.Literals(SLOTS));

const decodeSide = Schema.decodeUnknownOption(Schema.Literals(SIDES));

/** The section whose grip takes the focus as it shows up again, in the place its menu moved it to. */
let regrip: Section | undefined;

/**
 * Change the arrangement from a section's menu. A section that moves shows up anew in its new
 * place, without the grip the menu would give the focus back to, so its new grip takes it there.
 */
function updateFromMenu(section: Section, change: (layout: EditorLayout) => EditorLayout) {
  regrip = section;
  updateLayout(change);
  // A section that stayed put keeps its grip, and the menu gives the focus back to it.
  setTimeout(() => {
    regrip = undefined;
  });
}

/** The handle by a section's name: drag it to move the section, or click it for a menu of places. */
export function SectionGrip({ section }: { section: Section }) {
  const dock = use(DockContext);

  if (dock === undefined) return null;

  return <Grip section={section} dock={dock} />;
}

function Grip({ section, dock }: { section: Section; dock: Dock }) {
  const t = useMessages();
  const stacked = dock.arrangement.chat === "below";

  // The chat has nowhere else to go while it is stacked below.
  const { listeners, node, setNodeRef } = useDraggable({
    id: section,
    disabled: section === "chat" && stacked,
  });

  useEffect(() => {
    if (regrip !== section) return;

    regrip = undefined;
    node.current?.focus();
  }, [node, section]);

  const [open, setOpen] = useState(false);
  const wasOpen = useRef(false);
  const dragged = useRef(false);
  const name = nameOf(section, t);

  useDndMonitor({
    onDragStart: ({ active }) => {
      if (active.id === section) dragged.current = true;
    },
  });

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        // A press on the grip can start a drag, so the menu waits for the click that ends it.
        if (next && details.reason === "trigger-press" && details.event.type === "mousedown") {
          details.cancel();

          return;
        }

        setOpen(next);
      }}
    >
      <DropdownMenuTrigger
        ref={setNodeRef}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t.layout.move(name)}
            className="cursor-grab touch-none"
          />
        }
        onPointerDown={(event) => {
          wasOpen.current = open;
          dragged.current = false;
          listeners?.onPointerDown?.(event);
        }}
        onClick={(event) => {
          // A key press opens the menu on its own; a press that dragged the section is no click.
          if (event.detail !== 0 && !wasOpen.current && !dragged.current) setOpen(true);
        }}
      >
        <GripVerticalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-56">
        {Match.value(section).pipe(
          Match.when("chat", () => <ChatPlaces dock={dock} />),
          Match.orElse((strip) => <StripPlaces strip={strip} dock={dock} />),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={isDefaultLayout(dock.layout)}
          onClick={() => updateFromMenu(section, () => DEFAULT_LAYOUT)}
        >
          {t.layout.reset}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StripPlaces({ strip, dock }: { strip: StripId; dock: Dock }) {
  const t = useMessages();
  const { layout, arrangement, width } = dock;
  const name = nameOf(strip, t);
  const saved = slotOf(layout, strip);
  const sharing = layout.slots[saved];

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t.layout.place(name)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={saved}
        onValueChange={(value: string) => {
          const slot = decodeSlot(value);

          if (Option.isSome(slot)) {
            updateFromMenu(strip, (before) => moveStrip(before, strip, slot.value));
          }
        }}
      >
        {SLOTS.map((slot) => {
          const fits = slot === saved || fitsIn(layout, strip, slot, width);

          return (
            <DropdownMenuRadioItem key={slot} value={slot} closeOnClick disabled={!fits}>
              <span className="flex flex-col">
                {t.layout[SLOT_NAME[slot]]}
                {!fits && <span className="text-xs text-muted-foreground">{t.layout.narrow}</span>}
              </span>
            </DropdownMenuRadioItem>
          );
        })}
      </DropdownMenuRadioGroup>
      {arrangement.folded && saved !== "bottom" && (
        <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">{t.layout.folded}</p>
      )}
      {sharing.length > 1 && (
        <DropdownMenuItem
          onClick={() =>
            updateFromMenu(strip, (before) =>
              moveStrip(before, strip, saved, sharing.indexOf(strip) === 0 ? 1 : 0),
            )
          }
        >
          {t.layout.swap}
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  );
}

function ChatPlaces({ dock }: { dock: Dock }) {
  const t = useMessages();
  const stacked = dock.arrangement.chat === "below";

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>{t.layout.place(t.layout.chat)}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={dock.layout.chat}
        onValueChange={(value: string) => {
          const side = decodeSide(value);

          if (Option.isSome(side)) {
            updateFromMenu("chat", (before) => moveChat(before, side.value));
          }
        }}
      >
        <DropdownMenuRadioItem value="left" closeOnClick disabled={stacked}>
          {t.layout.leftEdge}
        </DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="right" closeOnClick disabled={stacked}>
          {t.layout.rightEdge}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {stacked && (
        <p className="max-w-56 px-2 py-1.5 text-xs text-muted-foreground">{t.layout.folded}</p>
      )}
    </DropdownMenuGroup>
  );
}
