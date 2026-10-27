import { expect } from "bun:test";

import { Effect, Option } from "effect";

import { bindPort, freePort } from "../electron/ports.ts";
import { it } from "./effect.ts";
import { holdPort } from "./support.ts";

it.live("keeps the server's last port while it is free, and moves off it once it is taken", () =>
  Effect.gen(function* () {
    const last = yield* bindPort(0);

    expect(yield* freePort(Option.some(last))).toBe(last);

    yield* holdPort(last);

    const moved = yield* freePort(Option.some(last));

    expect(moved).not.toBe(last);
    expect(yield* bindPort(moved)).toBe(moved);
  }),
);
