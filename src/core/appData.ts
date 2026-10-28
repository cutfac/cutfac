import { Context, Effect, FileSystem, Option, Path, Predicate, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";

import { WorkspaceError } from "./errors.ts";
import { replaceFile } from "./workspaceRoot.ts";

/**
 * The folder the app keeps its own records in, such as which workspaces the user trusts, outside
 * any workspace. None where it can't be found, and in tests that don't give one.
 */
export const AppData = Context.Reference<Option.Option<string>>("cutfac/AppData", {
  defaultValue: () => Option.none(),
});

const writeFailed = (file: string) => (error: PlatformError) =>
  new WorkspaceError({ message: `Could not write ${file}: ${error.message}` });

/**
 * Up to `maxBytes` of one of the app's own files; none while it isn't there. Any other failure
 * fails, so a record that couldn't be read is never taken for one with nothing in it.
 */
export const readAppFile = Effect.fn("AppData.readFile")(function* (
  file: string,
  maxBytes: number,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.stream(file, { bytesToRead: maxBytes }).pipe(
    Stream.decodeText,
    Stream.mkString,
    Effect.asSome,
    Effect.catch((error) =>
      Predicate.isTagged(error.reason, "NotFound")
        ? Effect.succeedNone
        : Effect.fail(new WorkspaceError({ message: `Could not read ${file}: ${error.message}` })),
    ),
  );
});

/**
 * Add a line to one of the app's own records, making the folder if it is missing. This,
 * `writeAppFile` and `initWorkspace` are the only writes outside an opened workspace.
 */
export const appendAppRecord = Effect.fn("AppData.appendRecord")(function* (
  file: string,
  line: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = writeFailed(file);

  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.mapError(failed));
  yield* fs.writeFileString(file, `${line}\n`, { flag: "a" }).pipe(Effect.mapError(failed));
});

/**
 * Replace one of the app's own files in a single step, so another process reading it sees the old
 * text or the new, never part of either.
 */
export const writeAppFile = Effect.fn("AppData.writeFile")(function* (file: string, text: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const failed = writeFailed(file);

  yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(Effect.mapError(failed));
  yield* replaceFile(file, (temp) => fs.writeFileString(temp, text)).pipe(Effect.mapError(failed));
});
