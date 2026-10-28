import { expect, test } from "bun:test";

import { routeOf } from "../web/src/lib/route.ts";

test("reads the view and the decoded id from the hash", () => {
  expect(routeOf("")).toEqual(["board", undefined]);
  expect(routeOf("#/")).toEqual(["board", undefined]);
  expect(routeOf("#/learn")).toEqual(["learn", undefined]);
  expect(routeOf("#/welcome/agent")).toEqual(["welcome", "agent"]);
  expect(routeOf("#/item/my%20video")).toEqual(["item", "my video"]);
  expect(routeOf("#/item/art%2Fruns")).toEqual(["item", "art/runs"]);
  expect(routeOf("#/templates/import/abc/def")).toEqual(["templates", "import/abc/def"]);
});

test("keeps an id with a malformed escape as typed instead of throwing", () => {
  expect(routeOf("#/item/%")).toEqual(["item", "%"]);
  expect(routeOf("#/templates/%E0")).toEqual(["templates", "%E0"]);
  expect(routeOf("#/item/a%20b%")).toEqual(["item", "a%20b%"]);
});
