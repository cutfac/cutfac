import { Duration, Effect } from "effect";

/** How long a quit goes on before the sheet says so; one quicker than this shows nothing. */
export const SHOW_AFTER = Duration.millis(500);

/**
 * A sheet saying Cutfac is quitting, shown once the quit takes more than a moment and closed by
 * interrupting this. `show` resolves true when the user chose to quit now, which runs `quitNow`.
 */
export const quitSheet = (
  show: (signal: AbortSignal) => Promise<boolean>,
  quitNow: Effect.Effect<void>,
) =>
  Effect.promise(show).pipe(
    Effect.delay(SHOW_AFTER),
    Effect.flatMap((now) => (now ? quitNow : Effect.void)),
  );
