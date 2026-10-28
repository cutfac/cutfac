import { describe, expect, test } from "bun:test";

import { Option } from "effect";

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

const idOf = (found: Option.Option<Announcement>) => Option.map(found, ({ id }) => id);

describe("which announcement the board shows", () => {
  test("none the first time the board opens, since a new user hasn't missed anything", () => {
    expect(unseen(ALL, Option.none())).toEqual(Option.none());
  });

  test("the newest one not yet seen", () => {
    expect(idOf(unseen(ALL, Option.some([])))).toEqual(Option.some("captions"));
    expect(idOf(unseen(ALL, Option.some(["captions"])))).toEqual(Option.some("variants"));
  });

  test("none once every one is seen", () => {
    expect(unseen(ALL, Option.some(["variants", "captions"]))).toEqual(Option.none());
    expect(unseen([], Option.some([]))).toEqual(Option.none());
  });
});

describe("what the board kept of the announcements seen", () => {
  test("reads the ids, one per line", () => {
    expect(parseSeen("captions\nvariants")).toEqual(Option.some(["captions", "variants"]));
    expect(parseSeen("captions")).toEqual(Option.some(["captions"]));
  });

  test("tells nothing seen yet from nothing kept, the first time the board opens", () => {
    expect(parseSeen("")).toEqual(Option.some([]));
    expect(parseSeen(null)).toEqual(Option.none());
  });
});

describe("showing the newest announcement again", () => {
  test("forgets only the newest", () => {
    expect(forgetNewest(ALL, Option.some(["captions", "variants"]))).toEqual(["variants"]);
  });

  test("counts the older ones as seen when the board kept nothing", () => {
    expect(forgetNewest(ALL, Option.none())).toEqual(["variants"]);
    expect(idOf(unseen(ALL, Option.some(forgetNewest(ALL, Option.none()))))).toEqual(
      Option.some("captions"),
    );
  });
});

test("announcement ids are distinct words the board can keep one per line", () => {
  const ids = ANNOUNCEMENTS.map(({ id }) => id);

  expect(new Set(ids).size).toBe(ids.length);

  for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
});
