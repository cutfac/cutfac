import { Effect, Option, Path, Schema } from "effect";

import { AppData, readAppFile, writeAppFile } from "./appData.ts";
import { InvalidRequest, WorkspaceError } from "./errors.ts";
import { Workspace } from "./workspace.ts";

/** One of the app's records: a JSON object, whose keys this release keeps even when it can't read them. */
const AppStore = Schema.fromJsonString(Schema.JsonObject, { space: 2 });

const decodeStore = Schema.decodeUnknownOption(AppStore);

/** Far more than any of the app's records needs; past this, the file isn't the app's. */
const STORE_BYTES = 4 * 1024 * 1024;

/** The app's record file `name`, or none where there is no app data folder. */
export const appStoreFile = Effect.fnUntraced(function* (name: string) {
  const dir = yield* AppData;
  const path = yield* Path.Path;

  return Option.map(dir, (found) => path.join(found, name));
});

/** The record in `file` as it is; empty while there is no file. */
export const readAppStore = Effect.fnUntraced(function* (file: string) {
  const text = yield* readAppFile(file, STORE_BYTES);

  if (Option.isNone(text)) return {} satisfies Schema.JsonObject;
  const store = decodeStore(text.value);

  if (Option.isNone(store)) {
    return yield* new WorkspaceError({ message: `${file} is not a list Cutfac can read` });
  }

  return store.value;
});

/**
 * The record `name` as it is, or empty where there is no app data folder or the file can't be
 * read, saying why in the log.
 */
export const peekAppStore = Effect.fnUntraced(function* (name: string) {
  const file = yield* appStoreFile(name);

  if (Option.isNone(file)) return {} satisfies Schema.JsonObject;

  return yield* readAppStore(file.value).pipe(
    Effect.tapError((error) => Effect.logWarning(`Could not read ${name}`, error)),
    Effect.orElseSucceed((): Schema.JsonObject => ({})),
  );
});

/**
 * Change the record `name` one change at a time, keeping everything `change` leaves as it was.
 * `what` names what the record keeps, for when there is no folder to keep it in.
 */
export const updateAppStore = Effect.fnUntraced(function* (
  name: string,
  what: string,
  change: (store: Schema.JsonObject) => Schema.JsonObject,
) {
  const ws = yield* Workspace;
  const file = yield* appStoreFile(name);

  if (Option.isNone(file)) {
    return yield* new InvalidRequest({ message: `There is no app data folder to keep ${what} in` });
  }

  yield* ws.exclusive(
    `app:${name}`,
    Effect.gen(function* () {
      const store = yield* readAppStore(file.value);

      const text = yield* Schema.encodeEffect(AppStore)(change(store)).pipe(
        Effect.mapError(
          (error) => new WorkspaceError({ message: `${file.value}: ${error.message}` }),
        ),
      );

      yield* writeAppFile(file.value, `${text}\n`);
    }),
  );
});
