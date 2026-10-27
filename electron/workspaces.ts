import { Effect, Option } from "effect";
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import type { CreateFailure, LibraryWorkspaces } from "../web/src/desktop.ts";
import { pickWorkspace } from "./dialogs.ts";
import {
  NEW_WORKSPACE_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  SWITCH_WORKSPACE_CHANNEL,
  WORKSPACES_CHANNEL,
} from "./ipc.ts";
import { decodeWorkspaceName, listWorkspaces, prepareWorkspace } from "./library.ts";
import { runInMain } from "./runtime.ts";
import { loadLibrary } from "./settings.ts";

export interface WorkspacesHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  window: () => BrowserWindow | undefined;
  /** The workspace open now, if any. */
  current: () => string | undefined;
  /** Whether a switch is under way, so another waits for it. */
  switching: () => boolean;
  /** Opens a workspace, saying why it couldn't. Resolves false if it didn't open. */
  activate: (workspace: string) => Promise<boolean>;
  /** What the folder dialog says, in the board's language. */
  chooseMessage: () => string;
}

/**
 * Switching workspaces from the board: the ones in the app's folder by name, a new one there by its
 * name alone, or any folder elsewhere through the folder dialog. A switch that fails goes back to
 * the workspace that was open.
 */
export function handleWorkspaces(host: WorkspacesHost) {
  const fromApp = (event: IpcMainInvokeEvent) => {
    if (!host.isFromApp(event)) throw new Error("Untrusted IPC sender");
  };

  const activate = (workspace: string) => Effect.promise(() => host.activate(workspace));

  const switchTo = (workspace: string) =>
    Effect.gen(function* () {
      const previous = host.current();

      if (yield* activate(workspace)) return true;

      if (previous) yield* activate(previous);

      return false;
    });

  /** Asks for a folder and switches to it. False if cancelled or if it failed to start. */
  const choose = Effect.gen(function* () {
    if (host.switching()) return false;

    const picked = yield* pickWorkspace(
      host.window(),
      host.chooseMessage(),
      Option.fromNullishOr(host.current()),
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

    const current = host.current();

    return runInMain(
      Effect.map(inLibrary, (found): LibraryWorkspaces => ({
        workspaces: found.map((workspace) => ({
          ...workspace,
          current: workspace.path === current,
        })),
      })),
    );
  });
  ipcMain.handle(SWITCH_WORKSPACE_CHANNEL, (event, name) => {
    fromApp(event);

    // Only a workspace the app's folder holds, by name, never a path a page sends.
    return runInMain(
      Effect.flatMap(inLibrary, (found) => {
        const named = found.find((one) => one.name === name);

        if (named === undefined || host.switching() || named.path === host.current()) {
          return Effect.succeed(false);
        }

        return switchTo(named.path);
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
