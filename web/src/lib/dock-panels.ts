import {
  SIDES,
  sizeOf,
  SLOTS,
  splitKey,
  type Arrangement,
  type EditorLayout,
  type Slot,
  type SizeKey,
  type StripId,
} from "./editor-layout.ts";

// The groups' ids name what they hold, so a group that comes back with other panels is sized anew.
export const outerGroup = (arrangement: Arrangement) => `dock-outer-${arrangement.chat}`;

export const columnsGroup = ({ slots }: Arrangement) =>
  `dock-columns${slots.left.length > 0 ? "-l" : ""}${slots.right.length > 0 ? "-r" : ""}`;

export const rowsGroup = ({ slots }: Arrangement) =>
  `dock-rows${slots.bottom.length > 0 ? "-b" : ""}`;

export const splitGroup = (slot: Slot, strips: readonly StripId[]) =>
  `dock-split-${slot}-${strips.join("-")}`;

export const CHAT_PANEL = "dock-chat";

export const slotPanel = (slot: Slot) => `dock-${slot}`;

export const stripPanel = (strip: StripId) => `dock-strip-${strip}`;

/** The chat's size: its width beside everything else, or its height below it. */
export const chatKeyOf = ({ chat }: Arrangement) => (chat === "below" ? "chat-below" : "chat");

/** A size the editor holds a panel to: what the user dragged its border to, else where it starts. */
export interface Want {
  readonly key: SizeKey;
  readonly panel: string;
  readonly group: string;
  /** Whether the group stacks its panels, so the size is a height. */
  readonly vertical: boolean;
  readonly size: number;
  readonly unit: "px" | "%";
  /** Whether a drag of the border is kept; a split made only for a narrow window is not. */
  readonly save: boolean;
}

export function wantsFor(layout: EditorLayout, arrangement: Arrangement): Want[] {
  const { slots, folded } = arrangement;
  const chatKey = chatKeyOf(arrangement);

  const wants: Want[] = [
    {
      key: chatKey,
      panel: CHAT_PANEL,
      group: outerGroup(arrangement),
      vertical: arrangement.chat === "below",
      size: sizeOf(layout, arrangement, chatKey),
      unit: "px",
      save: true,
    },
  ];

  for (const side of SIDES) {
    if (slots[side].length === 0) continue;

    wants.push({
      key: side,
      panel: slotPanel(side),
      group: columnsGroup(arrangement),
      vertical: false,
      size: sizeOf(layout, arrangement, side),
      unit: "px",
      save: true,
    });
  }

  if (slots.bottom.length > 0) {
    wants.push({
      key: "bottom",
      panel: slotPanel("bottom"),
      group: rowsGroup(arrangement),
      vertical: true,
      size: sizeOf(layout, arrangement, "bottom"),
      unit: "px",
      save: true,
    });
  }

  for (const slot of SLOTS) {
    const [first, second] = slots[slot];

    if (first === undefined || second === undefined) continue;

    const key = splitKey(slot);

    wants.push({
      key,
      panel: stripPanel(first),
      group: splitGroup(slot, slots[slot]),
      vertical: slot !== "bottom",
      size: sizeOf(layout, arrangement, key),
      unit: "%",
      save: !folded,
    });
  }

  return wants;
}
