import { Effect, Option, Schedule, Schema } from "effect";

import type { Permission } from "../web/src/desktop.ts";

const PERMISSIONS = ["screen", "accessibility"] as const satisfies ReadonlyArray<Permission>;

export const KnownPermission = Schema.Literals(PERMISSIONS);

const POLL = "1 second";

const WATCH_FOR = "10 minutes";

export const awaitGrant = (granted: Effect.Effect<boolean>) =>
  Effect.repeat(granted, { schedule: Schedule.spaced(POLL), until: (ok) => ok }).pipe(
    Effect.timeoutOption(WATCH_FOR),
    Effect.map(Option.filter((ok) => ok)),
  );
