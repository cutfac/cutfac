import { Effect, Option, Ref } from "effect";
import { ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import type { CreateFailure, LibraryWorkspaces } from "../web/src/desktop.ts";
import { pickWorkspace } from "./dialogs.ts";
import {
  NEW_WORKSPACE_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  SWITCH_WORKSPACE_CHANNEL,
  WORKSPACES_CHANNEL,
} from "./ipc.ts";
import { decodeWorkspaceName, listWorkspaces, prepareWorkspace } from "./library.ts";
import { MESSAGES } from "./messages.ts";
import { appState, runInMain, type AppServices } from "./runtime.ts";
import { loadLibrary } from "./settings.ts";

export interface WorkspacesHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** Opens a workspace, saying why it couldn't. False if it didn't open. */
  activate: (workspace: string) => Effect.Effect<boolean, never, AppServices>;
}

const { workspace: current, switching } = appState;

/**
 * Switching workspaces from the board: the ones in the app's folder by name, a new one there by its
 * name alone, or any folder elsewhere through the folder dialog. A switch that fails goes back to
 * the workspace that was open.
 */
export function handleWorkspaces(host: WorkspacesHost) {
  const fromApp = (event: IpcMainInvokeEvent) => {
    if (!host.isFromApp(event)) throw new Error("Untrusted IPC sender");
  };

  const switchTo = (workspace: string) =>
    Effect.gen(function* () {
      const previous = yield* Ref.get(current);

      if (yield* host.activate(workspace)) return true;

      if (Option.isSome(previous)) yield* host.activate(previous.value);

      return false;
    });

  /** Asks for a folder and switches to it. False if cancelled or if it failed to start. */
  const choose = Effect.gen(function* () {
    if (yield* Ref.get(switching)) return false;

    const picked = yield* pickWorkspace(
      Option.getOrUndefined(yield* Ref.get(appState.window)),
      MESSAGES[yield* Ref.get(appState.locale)].chooseWorkspace,
      yield* Ref.get(current),
    );

    return Option.isSome(picked) ? yield* switchTo(picked.value) : false;
  });

  const inLibrary = Effect.flatMap(loadLibrary, listWorkspaces);

  ipcMain.handle(OPEN_WORKSPACE_CHANNEL, (event) => {
    fromApp(event);

    return runInMain(choose);
  });
  ipcMain.handle(WORKSPACES_CHANNEL, (event) => {
    fromApp(event);

    return runInMain(
      Effect.gen(function* () {
        const found = yield* inLibrary;
        const open = yield* Ref.get(current);

        const listed: LibraryWorkspaces = {
          workspaces: found.map((workspace) => ({
            ...workspace,
            current: Option.contains(open, workspace.path),
          })),
        };

        return listed;
      }),
    );
  });
  ipcMain.handle(SWITCH_WORKSPACE_CHANNEL, (event, name) => {
    fromApp(event);

    // Only a workspace the app's folder holds, by name, never a path a page sends.
    return runInMain(
      Effect.gen(function* () {
        const named = (yield* inLibrary).find((one) => one.name === name);

        if (
          named === undefined ||
          (yield* Ref.get(switching)) ||
          Option.contains(yield* Ref.get(current), named.path)
        ) {
          return false;
        }

        return yield* switchTo(named.path);
      }),
    );
  });
  ipcMain.handle(NEW_WORKSPACE_CHANNEL, (event, input) => {
    fromApp(event);

    return runInMain(
      Option.match(decodeWorkspaceName(input), {
        onNone: () => Effect.succeed<CreateFailure>({ kind: "invalid" }),
        onSome: (name) =>
          Effect.gen(function* () {
            const prepared = yield* prepareWorkspace(yield* loadLibrary, name, false);

            if (prepared.kind === "taken") return { kind: "taken" } satisfies CreateFailure;

            // A switch that fails has said why in a dialog already.
            return (yield* switchTo(prepared.path))
              ? undefined
              : ({ kind: "failed", message: "" } satisfies CreateFailure);
          }).pipe(
            Effect.catch((error) =>
              Effect.succeed<CreateFailure>({ kind: "failed", message: error.message }),
            ),
          ),
      }),
    );
  });

  return { choose: () => runInMain(choose) };
}
