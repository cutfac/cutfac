import { expect, test } from "bun:test";

import { dayLabel } from "../web/src/lib/time.ts";

const now = new Date(2026, 9, 26, 15, 0).getTime();

const at = (month: number, day: number, hour: number, year = 2026) =>
  new Date(year, month, day, hour).toISOString();

test("names today and yesterday by the calendar day, not by 24 hours", () => {
  expect(dayLabel(at(9, 26, 0), "en", now)).toBe("today");
  expect(dayLabel(at(9, 25, 23), "en", now)).toBe("yesterday");
  expect(dayLabel(at(9, 25, 1), "ko", now)).toBe("어제");
});

test("dates older days, with the year only when it differs", () => {
  expect(dayLabel(at(9, 20, 12), "en", now)).toBe("October 20");
  expect(dayLabel(at(11, 31, 12, 2025), "en", now)).toBe("December 31, 2025");
});
