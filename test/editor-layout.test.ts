import { describe, expect, test } from "bun:test";

import {
  arrange,
  columnsOf,
  DEFAULT_LAYOUT,
  fitsIn,
  isDefaultLayout,
  moveChat,
  moveStrip,
  PANEL,
  parseLayout,
  serializeLayout,
  sizeOf,
  slotOf,
  widthFor,
  withoutSize,
  withSize,
  type EditorLayout,
} from "../web/src/lib/editor-layout.ts";

const WIDE = 2000;

describe("parseLayout", () => {
  test("starts from the default when nothing is stored or it cannot be read", () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("")).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout('{"version":1,"chat":"left"}')).toEqual(DEFAULT_LAYOUT);
    expect(parseLayout("v=2&chat=left")).toEqual(DEFAULT_LAYOUT);
  });

  test("reads back what it wrote", () => {
    const layout = withSize(
      moveChat(moveStrip(DEFAULT_LAYOUT, "references", "right"), "left"),
      "chat",
      380,
    );

    expect(parseLayout(serializeLayout(layout))).toEqual(layout);
  });

  test("keeps each strip once, in a known slot, and puts a missing one below", () => {
    const stored = "v=1&left=references,references,clips&right=references&top=media&chat=middle";

    expect(parseLayout(stored)).toEqual({
      slots: { bottom: ["media"], left: ["references"], right: [] },
      chat: "right",
      sizes: {},
    });
  });

  test("drops sizes that are out of range, unreadable or unknown", () => {
    const stored = [
      "v=1&bottom=media,references",
      "size.chat=380",
      "size.left=-5",
      "size.right=",
      "size.bottom=abc",
      "size.split-bottom=140",
      "size.split-left=30",
      "size.top=9",
    ].join("&");

    expect(parseLayout(stored).sizes).toEqual({ chat: 380, "split-left": 30 });
  });
});

describe("moveStrip", () => {
  test("moves a strip to another slot, at the end by default", () => {
    const moved = moveStrip(DEFAULT_LAYOUT, "references", "right");

    expect(moved.slots).toEqual({ bottom: ["media"], left: [], right: ["references"] });
    expect(slotOf(moved, "references")).toBe("right");
  });

  test("puts a strip before or after the one already there", () => {
    const right = moveStrip(DEFAULT_LAYOUT, "references", "right");

    expect(moveStrip(right, "media", "right", 0).slots.right).toEqual(["media", "references"]);
    expect(moveStrip(right, "media", "right", 1).slots.right).toEqual(["references", "media"]);
    expect(moveStrip(right, "media", "right", 9).slots.right).toEqual(["references", "media"]);
  });

  test("reorders within a slot", () => {
    expect(moveStrip(DEFAULT_LAYOUT, "media", "bottom", 1).slots.bottom).toEqual([
      "references",
      "media",
    ]);
  });

  test("returns the same layout when nothing moves", () => {
    expect(moveStrip(DEFAULT_LAYOUT, "media", "bottom", 0)).toBe(DEFAULT_LAYOUT);
    expect(moveStrip(DEFAULT_LAYOUT, "references", "bottom")).toBe(DEFAULT_LAYOUT);
    expect(moveChat(DEFAULT_LAYOUT, "right")).toBe(DEFAULT_LAYOUT);
  });

  test("starts the split over in the slots that change and keeps the other sizes", () => {
    const sized: EditorLayout = {
      ...DEFAULT_LAYOUT,
      sizes: { "split-bottom": 30, "split-left": 60, chat: 380 },
    };

    expect(moveStrip(sized, "media", "right").sizes).toEqual({ "split-left": 60, chat: 380 });
  });
});

describe("sizes", () => {
  test("keeps a dragged size, rounded, and forgets it on reset", () => {
    const sized = withSize(DEFAULT_LAYOUT, "chat", 380.04);

    expect(sized.sizes).toEqual({ chat: 380 });
    expect(withSize(sized, "chat", 380)).toBe(sized);
    expect(withoutSize(sized, "chat")).toEqual(DEFAULT_LAYOUT);
    expect(withoutSize(DEFAULT_LAYOUT, "chat")).toBe(DEFAULT_LAYOUT);
  });

  test("ignores a size that cannot be right", () => {
    expect(withSize(DEFAULT_LAYOUT, "split-bottom", 100)).toBe(DEFAULT_LAYOUT);
    expect(withSize(DEFAULT_LAYOUT, "left", Number.NaN)).toBe(DEFAULT_LAYOUT);
  });

  test("is the dragged size, else where the border starts", () => {
    const wide = arrange(DEFAULT_LAYOUT, WIDE);

    expect(sizeOf(DEFAULT_LAYOUT, wide, "chat")).toBe(PANEL.chat.initial);
    expect(sizeOf(DEFAULT_LAYOUT, wide, "left")).toBe(PANEL.column.initial);
    expect(sizeOf(DEFAULT_LAYOUT, wide, "split-bottom")).toBe(50);
    expect(sizeOf(withSize(DEFAULT_LAYOUT, "chat", 380), wide, "chat")).toBe(380);
  });

  test("shares a slot half and half while strips are folded into it", () => {
    const layout = withSize(
      withSize(moveStrip(DEFAULT_LAYOUT, "references", "left"), "split-bottom", 30),
      "bottom",
      200,
    );

    const folded = arrange(layout, widthFor(1) - 1);

    expect(sizeOf(layout, folded, "split-bottom")).toBe(50);
    expect(sizeOf(layout, folded, "bottom")).toBe(200);
    expect(sizeOf(layout, arrange(layout, WIDE), "split-bottom")).toBe(30);
  });

  test("tells the default layout apart", () => {
    expect(isDefaultLayout(parseLayout(null))).toBe(true);
    expect(isDefaultLayout(moveChat(DEFAULT_LAYOUT, "left"))).toBe(false);
    expect(isDefaultLayout(withSize(DEFAULT_LAYOUT, "bottom", 200))).toBe(false);
  });
});

describe("arrange", () => {
  const twoColumns = moveStrip(moveStrip(DEFAULT_LAYOUT, "media", "left"), "references", "right");
  const fitsTwo = widthFor(2);
  const fitsOne = widthFor(1);
  const fitsChat = widthFor(0);

  test("shows the saved layout when there is room", () => {
    expect(arrange(twoColumns, WIDE)).toEqual({
      slots: twoColumns.slots,
      chat: "right",
      folded: false,
    });
    expect(arrange(twoColumns, fitsTwo).folded).toBe(false);
  });

  test("folds the side columns below the preview when they do not fit", () => {
    expect(arrange(twoColumns, fitsTwo - 1)).toEqual({
      slots: { bottom: ["media", "references"], left: [], right: [] },
      chat: "right",
      folded: true,
    });

    const oneColumn = moveStrip(DEFAULT_LAYOUT, "references", "left");

    expect(arrange(oneColumn, fitsTwo - 1).folded).toBe(false);
    expect(arrange(oneColumn, fitsOne - 1).slots.bottom).toEqual(["media", "references"]);
  });

  test("puts the chat below when the window is too narrow to share", () => {
    const left = moveChat(DEFAULT_LAYOUT, "left");

    expect(arrange(left, fitsChat).chat).toBe("left");
    expect(arrange(left, fitsChat - 1)).toEqual({
      slots: DEFAULT_LAYOUT.slots,
      chat: "below",
      folded: false,
    });
    expect(arrange(twoColumns, fitsChat - 1).folded).toBe(true);
  });

  test("counts the columns beside the preview", () => {
    expect(columnsOf(DEFAULT_LAYOUT)).toBe(0);
    expect(columnsOf(twoColumns)).toBe(2);
    expect(columnsOf(arrange(twoColumns, fitsTwo - 1))).toBe(0);
  });

  test("tells whether a strip shows where it is put or folds below", () => {
    expect(fitsIn(DEFAULT_LAYOUT, "references", "left", fitsOne)).toBe(true);
    expect(fitsIn(DEFAULT_LAYOUT, "references", "left", fitsOne - 1)).toBe(false);
    expect(fitsIn(DEFAULT_LAYOUT, "references", "bottom", 100, 0)).toBe(true);

    const oneColumn = moveStrip(DEFAULT_LAYOUT, "media", "left");

    expect(fitsIn(oneColumn, "references", "right", fitsTwo - 1)).toBe(false);
    expect(fitsIn(oneColumn, "references", "left", fitsOne, 0)).toBe(true);
  });

  test("leaves the saved layout as it was", () => {
    arrange(twoColumns, 100);

    expect(twoColumns.slots).toEqual({ bottom: [], left: ["media"], right: ["references"] });
  });
});
