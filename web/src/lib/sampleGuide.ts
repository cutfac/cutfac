import { Option, Schema } from "effect";

import { readStored, removeStored, writeStored } from "./storage.ts";

/**
 * What the guide on a sample walks through, in order: watch it, point at a part, ask, compare,
 * and then make one's own.
 */
export const GUIDE_STEPS = ["play", "select", "ask", "variants", "done"] as const;

export type GuideStep = (typeof GUIDE_STEPS)[number];

const Guide = Schema.Struct({ item: Schema.String, step: Schema.Literals(GUIDE_STEPS) });

export type Guide = typeof Guide.Type;

const decodeGuide = Schema.decodeUnknownOption(Schema.fromJsonString(Guide));

const KEY = "cutfac.sampleGuide";

const listeners = new Set<() => void>();

/** The guide as stored, unchanged between changes, for `useSyncExternalStore`. */
export const storedGuide = () => readStored(KEY);

/** The guide under way, on the sample it is for; none once it ends or was never started. */
export const guideOf = (stored: string | null): Option.Option<Guide> =>
  Option.flatMap(Option.fromNullishOr(stored), decodeGuide);

export function saveGuide(guide: Guide) {
  writeStored(KEY, JSON.stringify(guide));

  for (const listener of listeners) listener();
}

export function endGuide() {
  removeStored(KEY);

  for (const listener of listeners) listener();
}

export function onGuide(listener: () => void) {
  listeners.add(listener);

  return () => listeners.delete(listener);
}
