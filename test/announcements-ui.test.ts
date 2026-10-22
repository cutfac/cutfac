import { describe, expect, test } from "bun:test";

import {
  ANNOUNCEMENTS,
  forgetNewest,
  parseSeen,
  unseen,
  type Announcement,
} from "../web/src/lib/announcements.ts";

const announcement = (id: string): Announcement => {
  const copy = { title: id, body: `${id} is here.` };

  return { id, copy: { en: copy, ko: copy } };
};

/** Newest first, as the board lists them. */
const ALL = [announcement("captions"), announcement("variants")];

describe("which announcement the board shows", () => {
  test("none the first time the board opens, since a new user hasn't missed anything", () => {
    expect(unseen(ALL, undefined)).toBeUndefined();
  });

  test("the newest one not yet seen", () => {
    expect(unseen(ALL, [])?.id).toBe("captions");
    expect(unseen(ALL, ["captions"])?.id).toBe("variants");
  });

  test("none once every one is seen", () => {
    expect(unseen(ALL, ["variants", "captions"])).toBeUndefined();
    expect(unseen([], [])).toBeUndefined();
  });
});

describe("what the board kept of the announcements seen", () => {
  test("reads the ids, one per line", () => {
    expect(parseSeen("captions\nvariants")).toEqual(["captions", "variants"]);
    expect(parseSeen("captions")).toEqual(["captions"]);
  });

  test("tells nothing seen yet from nothing kept, the first time the board opens", () => {
    expect(parseSeen("")).toEqual([]);
    expect(parseSeen(null)).toBeUndefined();
  });
});

describe("showing the newest announcement again", () => {
  test("forgets only the newest", () => {
    expect(forgetNewest(ALL, ["captions", "variants"])).toEqual(["variants"]);
  });

  test("counts the older ones as seen when the board kept nothing", () => {
    expect(forgetNewest(ALL, undefined)).toEqual(["variants"]);
    expect(unseen(ALL, forgetNewest(ALL, undefined))?.id).toBe("captions");
  });
});

test("announcement ids are distinct words the board can keep one per line", () => {
  const ids = ANNOUNCEMENTS.map(({ id }) => id);

  expect(new Set(ids).size).toBe(ids.length);

  for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
});
