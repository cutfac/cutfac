import { expect, test } from "bun:test";

import { Option } from "effect";

import { failedAfter, LiveState, shownOf } from "../web/src/lib/live.ts";

test("a failed reload keeps showing what was loaded, however many reloads fail", () => {
  const once = failedAfter("offline", LiveState.Loaded({ data: "items" }));
  const twice = failedAfter("still offline", once);

  expect(shownOf(once)).toEqual(Option.some("items"));
  expect(twice).toEqual(LiveState.Failed({ error: "still offline", last: Option.some("items") }));
});

test("a first load that fails has nothing to show", () => {
  expect(shownOf(failedAfter("offline", LiveState.Loading()))).toEqual(Option.none());
});
