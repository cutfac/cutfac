import { describe, expect, test } from "bun:test";

import { askingChanges, type Asking } from "../electron/asking.ts";

const approval = (id: string): Asking => ({ id, title: `Video ${id}`, about: "approval" });

const question = (id: string): Asking => ({ id, title: `Video ${id}`, about: "question" });

describe("what the agents asking change", () => {
  test("notifies only about what starts asking while the app is in the background", () => {
    const before = askingChanges(new Set(), [approval("a")], true).now;

    expect(
      askingChanges(before, [approval("a"), question("a"), approval("b")], true).notify,
    ).toEqual([question("a"), approval("b")]);
    expect(askingChanges(before, [approval("b")], false).notify).toEqual([]);
  });

  test("keeps what asks now, so what was answered can be cleared", () => {
    expect(askingChanges(new Set(["approval a"]), [question("b")], true).now).toEqual(
      new Set(["question b"]),
    );
  });
});
