import { describe, expect, test } from "bun:test";

import { chatZoneId, dropOn, stripZones } from "../web/src/lib/dock-zones.ts";
import {
  DEFAULT_LAYOUT,
  moveStrip,
  widthFor,
  type EditorLayout,
} from "../web/src/lib/editor-layout.ts";

const WIDE = 2000;

const SPREAD: EditorLayout = moveStrip(DEFAULT_LAYOUT, "references", "right");

describe("dropping a strip on a zone", () => {
  test("puts it in the slot and at the place that zone shows", () => {
    const zones = stripZones(SPREAD, "media", WIDE);

    expect(zones.map(({ slot, index }) => `${slot}-${index}`)).toEqual([
      "bottom-0",
      "left-0",
      "right-0",
      "right-1",
    ]);

    for (const zone of zones) {
      const dropped = dropOn(SPREAD, "media", zone.id, WIDE);

      expect(dropped.slots[zone.slot][zone.index]).toBe("media");
    }
  });

  test("does nothing on a zone the window is too narrow to show the strip in", () => {
    const narrow = widthFor(1) - 1;
    const zone = stripZones(SPREAD, "media", narrow).find(({ slot }) => slot === "left");

    expect(zone?.disabled).toBe(true);
    expect(dropOn(SPREAD, "media", zone?.id ?? "", narrow)).toBe(SPREAD);
  });

  test("does nothing on a zone that is for the chat", () => {
    expect(dropOn(SPREAD, "media", chatZoneId("left"), WIDE)).toBe(SPREAD);
  });
});

describe("dropping the chat on a zone", () => {
  test("moves it to that edge", () => {
    expect(dropOn(DEFAULT_LAYOUT, "chat", chatZoneId("left"), WIDE).chat).toBe("left");
    expect(dropOn(DEFAULT_LAYOUT, "chat", chatZoneId("right"), WIDE)).toBe(DEFAULT_LAYOUT);
  });

  test("does nothing on a zone that is for a strip", () => {
    const [zone] = stripZones(DEFAULT_LAYOUT, "media", WIDE);

    expect(dropOn(DEFAULT_LAYOUT, "chat", zone?.id ?? "", WIDE)).toBe(DEFAULT_LAYOUT);
  });
});
