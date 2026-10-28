import { Crypto, Effect, FileSystem, Path } from "effect";
import type { PlatformError } from "effect/PlatformError";

/**
 * Have `write` fill a temp file beside `full`, then rename it over `full` in one step, so a reader
 * sees the old file or the new, never part of either. The temp starts with a dot, which listings
 * and the change stream skip, and it is removed if anything fails.
 */
export const replaceFile = Effect.fnUntraced(function* (
  full: string,
  write: (temp: string) => Effect.Effect<void, PlatformError>,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;
  const temp = path.join(path.dirname(full), `.${yield* Effect.orDie(crypto.randomUUIDv4())}.tmp`);

  yield* write(temp).pipe(
    Effect.andThen(fs.rename(temp, full)),
    Effect.onError(() => fs.remove(temp, { force: true }).pipe(Effect.ignore)),
  );
});
