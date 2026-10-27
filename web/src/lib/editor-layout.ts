import { Option, Schema } from "effect";

/**
 * How the item editor's sections are arranged around the preview, which stays in the middle: the
 * media and reference strips each sit below it, left of it or right of it, and the chat panel
 * sits at the left or right edge. One arrangement serves every item, kept in this browser.
 */

export const STRIPS = ["media", "references"] as const;

export type StripId = (typeof STRIPS)[number];

/** Where a strip can sit, around the preview. */
export const SLOTS = ["bottom", "left", "right"] as const;

export type Slot = (typeof SLOTS)[number];

/** The slots beside the preview, and the edges the chat panel can sit at. */
export const SIDES = ["left", "right"] as const;

export type Side = (typeof SIDES)[number];

type Slots = Readonly<Record<Slot, readonly StripId[]>>;

/**
 * Sizes the user dragged a border to. Widths of the chat and the side columns and the heights of
 * the bottom row and of the chat stacked below are in pixels; a `split-` is the share of the first
 * of two strips in one slot, in percent.
 */
export const SIZE_KEYS = [
  "chat",
  "chat-below",
  "left",
  "right",
  "bottom",
  "split-bottom",
  "split-left",
  "split-right",
] as const;

export type SizeKey = (typeof SIZE_KEYS)[number];

export interface EditorLayout {
  /** The strips in each slot, in order: left to right below the preview, top to bottom beside it. */
  readonly slots: Slots;
  readonly chat: Side;
  readonly sizes: Readonly<Partial<Record<SizeKey, number>>>;
}

export const DEFAULT_LAYOUT: EditorLayout = {
  slots: { bottom: ["media", "references"], left: [], right: [] },
  chat: "right",
  sizes: {},
};

/** Pixel sizes a section starts at and will not be dragged below. */
export const PANEL = {
  chat: { initial: 420, min: 300 },
  chatBelow: { initial: 320, min: 200 },
  column: { initial: 260, min: 200 },
  bottom: { initial: 140, min: 112 },
  /** One of two strips sharing a slot: its width below the preview, its height beside it. */
  strip: { minWidth: 160, minHeight: 112 },
  center: { min: 360 },
  /** The preview with the timeline and the transport under it, in height. */
  stage: { min: 280 },
  /** Everything but the chat, in height, once the chat is below it. */
  stacked: { min: 480 },
} as const;

/** Where each border starts, in the unit of its size. */
const INITIAL: Readonly<Record<SizeKey, number>> = {
  chat: PANEL.chat.initial,
  "chat-below": PANEL.chatBelow.initial,
  left: PANEL.column.initial,
  right: PANEL.column.initial,
  bottom: PANEL.bottom.initial,
  "split-bottom": 50,
  "split-left": 50,
  "split-right": 50,
};

/** The borders that can be dragged: a line beside the chat, a gap between the preview and a strip. */
export const BORDER = { edge: 1, inner: 12 } as const;

/** The main area's padding, `p-4` on each side. */
const PADDING = 32;

/** The narrowest the area beside the chat gets with `columns` strip columns next to the preview. */
export const mainMinWidth = (columns: number) =>
  PANEL.center.min + (PANEL.column.min + BORDER.inner) * columns + PADDING;

/** The narrowest the editor gets with the chat beside everything else and `columns` columns. */
export const widthFor = (columns: number) => PANEL.chat.min + BORDER.edge + mainMinWidth(columns);

/** How many columns of strips stand beside the preview. */
export const columnsOf = ({ slots }: { readonly slots: Slots }) =>
  SIDES.filter((side) => slots[side].length > 0).length;

/** What the editor shows at a given width; the saved layout comes back once the window widens. */
export interface Arrangement {
  readonly slots: Slots;
  /** The chat goes below everything else when the window is too narrow to share its width. */
  readonly chat: Side | "below";
  /** Strips saved beside the preview are below it for now, for want of room. */
  readonly folded: boolean;
}

export function arrange(layout: EditorLayout, width: number): Arrangement {
  const columns = columnsOf(layout);
  const stacked = width < widthFor(0);
  const folded = columns > 0 && (stacked || width < widthFor(columns));
  const { bottom, left, right } = layout.slots;

  return {
    slots: folded ? { bottom: [...bottom, ...left, ...right], left: [], right: [] } : layout.slots,
    chat: stacked ? "below" : layout.chat,
    folded,
  };
}

/**
 * The size a border is at: where the user dragged it, else where it starts. Two strips folded into
 * one slot for want of room share it half and half.
 */
export const sizeOf = (layout: EditorLayout, arrangement: Arrangement, key: SizeKey) =>
  arrangement.folded && isSplit(key) ? INITIAL[key] : (layout.sizes[key] ?? INITIAL[key]);

export function slotOf(layout: EditorLayout, strip: StripId): Slot {
  return SLOTS.find((slot) => layout.slots[slot].includes(strip)) ?? "bottom";
}

/** The size of the first of two strips sharing `slot`. */
export const splitKey = (slot: Slot): SizeKey => `split-${slot}`;

const isSplit = (key: SizeKey) => key.startsWith("split-");

function withoutKeys(
  sizes: EditorLayout["sizes"],
  keys: ReadonlyArray<SizeKey>,
): EditorLayout["sizes"] {
  const kept: Partial<Record<SizeKey, number>> = {};

  for (const key of SIZE_KEYS) {
    const size = sizes[key];

    if (size !== undefined && !keys.includes(key)) kept[key] = size;
  }

  return kept;
}

/**
 * Put `strip` into `slot` at `index` (to the end when past it). The split of a slot whose strips
 * change starts over at half and half. Returns `layout` itself when nothing moves.
 */
export function moveStrip(
  layout: EditorLayout,
  strip: StripId,
  slot: Slot,
  index = Number.POSITIVE_INFINITY,
): EditorLayout {
  const from = slotOf(layout, strip);
  const slots: Record<Slot, readonly StripId[]> = { ...layout.slots };

  slots[from] = slots[from].filter((other) => other !== strip);

  const into = [...slots[slot]];

  into.splice(Math.max(0, Math.min(index, into.length)), 0, strip);
  slots[slot] = into;

  if (slots[slot].join() === layout.slots[slot].join()) return layout;

  return { ...layout, slots, sizes: withoutKeys(layout.sizes, [splitKey(from), splitKey(slot)]) };
}

/** Whether `strip`, put into `slot` at `index`, shows there at `width` rather than folded below. */
export const fitsIn = (
  layout: EditorLayout,
  strip: StripId,
  slot: Slot,
  width: number,
  index?: number,
) => arrange(moveStrip(layout, strip, slot, index), width).slots[slot].includes(strip);

export const moveChat = (layout: EditorLayout, side: Side): EditorLayout =>
  side === layout.chat ? layout : { ...layout, chat: side };

/** Keep a size the user dragged a border to; returns `layout` itself when it is the same. */
export function withSize(layout: EditorLayout, key: SizeKey, size: number): EditorLayout {
  const rounded = Math.round(size * 10) / 10;

  if (!validSize(key, rounded) || layout.sizes[key] === rounded) return layout;

  return { ...layout, sizes: { ...layout.sizes, [key]: rounded } };
}

/** Go back to the starting size of one border. */
export const withoutSize = (layout: EditorLayout, key: SizeKey): EditorLayout =>
  layout.sizes[key] === undefined ? layout : { ...layout, sizes: withoutKeys(layout.sizes, [key]) };

export const isDefaultLayout = (layout: EditorLayout) =>
  serializeLayout(layout) === serializeLayout(DEFAULT_LAYOUT);

const validSize = (key: SizeKey, size: number) =>
  Number.isFinite(size) && size > 0 && size < (isSplit(key) ? 100 : 10_000);

/*
 * Stored as a query string, `v=1&chat=right&bottom=media,references&left=&right=&size.chat=380`:
 * every value is text to compare with the names it may hold, or a number to read.
 */

const VERSION = "1";

const sizeParam = (key: SizeKey) => `size.${key}`;

const decodeStrip = Schema.decodeUnknownOption(Schema.Literals(STRIPS));

const decodeSide = Schema.decodeUnknownOption(Schema.Literals(SIDES));

const decodeSize = Schema.decodeUnknownOption(Schema.FiniteFromString);

/**
 * Read a stored layout, keeping what still makes sense: each strip once, in a known slot (a strip
 * it misses goes below the preview), and sizes in range. Anything unreadable is the default.
 */
export function parseLayout(raw: string | null): EditorLayout {
  if (raw === null) return DEFAULT_LAYOUT;

  const stored = new URLSearchParams(raw);

  if (stored.get("v") !== VERSION) return DEFAULT_LAYOUT;

  const slots: Record<Slot, StripId[]> = { bottom: [], left: [], right: [] };
  const placed = new Set<StripId>();

  for (const slot of SLOTS) {
    for (const name of (stored.get(slot) ?? "").split(",")) {
      const strip = decodeStrip(name);

      if (Option.isNone(strip) || placed.has(strip.value)) continue;

      placed.add(strip.value);
      slots[slot].push(strip.value);
    }
  }

  for (const strip of STRIPS) if (!placed.has(strip)) slots.bottom.push(strip);

  const sizes: Partial<Record<SizeKey, number>> = {};

  for (const key of SIZE_KEYS) {
    const size = decodeSize(stored.get(sizeParam(key)));

    if (Option.isSome(size) && validSize(key, size.value)) sizes[key] = size.value;
  }

  const chat = Option.getOrElse(decodeSide(stored.get("chat")), () => DEFAULT_LAYOUT.chat);

  return { slots, chat, sizes };
}

export function serializeLayout(layout: EditorLayout) {
  const params = new URLSearchParams({ v: VERSION, chat: layout.chat });

  for (const slot of SLOTS) params.set(slot, layout.slots[slot].join(","));

  for (const key of SIZE_KEYS) {
    const size = layout.sizes[key];

    if (size !== undefined) params.set(sizeParam(key), String(size));
  }

  return params.toString();
}
