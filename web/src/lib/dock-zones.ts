import { Array, Option, Schema } from "effect";

import {
  fitsIn,
  moveChat,
  moveStrip,
  SIDES,
  SLOTS,
  STRIPS,
  type EditorLayout,
  type Side,
  type Slot,
  type StripId,
} from "./editor-layout.ts";

const SECTIONS = ["chat", ...STRIPS] as const;

/** What has a grip: a strip, or the chat panel. */
export type Section = (typeof SECTIONS)[number];

/** The section a drag's id names, if it names one. */
export const sectionOf = Schema.decodeUnknownOption(Schema.Literals(SECTIONS));

export const chatZoneId = (side: Side) => `chat-${side}`;

export interface StripZone {
  readonly id: string;
  readonly slot: Slot;
  /** Where among the slot's other strips the dragged one goes. */
  readonly index: number;
  /** The window is too narrow to show the strip there. */
  readonly disabled: boolean;
}

/** The places a dragged strip can go: before, between or after the strips in each slot. */
export function stripZones(layout: EditorLayout, strip: StripId, width: number) {
  const zones: StripZone[] = [];

  for (const slot of SLOTS) {
    const others = layout.slots[slot].filter((other) => other !== strip).length;

    for (let index = 0; index <= others; index++) {
      const disabled = !fitsIn(layout, strip, slot, width, index);

      zones.push({ id: `strip-${slot}-${index}`, slot, index, disabled });
    }
  }

  return zones;
}

/** The layout after `section` is dropped on the zone `overId`; `layout` itself if that moves nothing. */
export function dropOn(
  layout: EditorLayout,
  section: Section,
  overId: string | number,
  width: number,
): EditorLayout {
  if (section === "chat") {
    return Option.match(
      Array.findFirst(SIDES, (side) => chatZoneId(side) === overId),
      { onNone: () => layout, onSome: (side) => moveChat(layout, side) },
    );
  }

  return Option.match(
    Array.findFirst(
      stripZones(layout, section, width),
      (zone) => zone.id === overId && !zone.disabled,
    ),
    { onNone: () => layout, onSome: (zone) => moveStrip(layout, section, zone.slot, zone.index) },
  );
}
