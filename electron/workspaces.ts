import { Option } from "effect";
import { ipcMain, type BrowserWindow, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";

import type { CreateFailure, LibraryWorkspaces } from "../web/src/desktop.ts";
import { pickWorkspace } from "./dialogs.ts";
import {
  NEW_WORKSPACE_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  SWITCH_WORKSPACE_CHANNEL,
  WORKSPACES_CHANNEL,
} from "./ipc.ts";
import { decodeWorkspaceName, listWorkspaces, prepareWorkspace, type Prepared } from "./library.ts";
import { runInMain } from "./runtime.ts";
import { loadLibrary } from "./settings.ts";

export const workspacesIn = (library: string) => runInMain(listWorkspaces(library));

export const prepareWorkspaceFolder = (
  library: string,
  name: string,
  reuse: boolean,
): Promise<Prepared> => runInMain(prepareWorkspace(library, name, reuse));

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
  const assertFromApp = (event: IpcMainInvokeEvent) => {
    if (!host.isFromApp(event)) throw new Error("Untrusted IPC sender");
  };

  const switchTo = async (workspace: string) => {
    const previous = host.current();

    if (await host.activate(workspace)) return true;

    if (previous) await host.activate(previous);

    return false;
  };

  /** Asks for a folder and switches to it. Resolves false if cancelled or if it failed to start. */
  const choose = async () => {
    if (host.switching()) return false;

    const workspace = await pickWorkspace(host.window(), host.chooseMessage(), host.current());

    return workspace ? switchTo(workspace) : false;
  };

  ipcMain.handle(OPEN_WORKSPACE_CHANNEL, (event) => {
    assertFromApp(event);

    return choose();
  });
  ipcMain.handle(WORKSPACES_CHANNEL, async (event): Promise<LibraryWorkspaces> => {
    assertFromApp(event);

    const current = host.current();
    const found = await workspacesIn(await runInMain(loadLibrary));

    return {
      workspaces: found.map((workspace) => ({ ...workspace, current: workspace.path === current })),
    };
  });
  ipcMain.handle(SWITCH_WORKSPACE_CHANNEL, async (event, name) => {
    assertFromApp(event);

    // Only a workspace the app's folder holds, by name, never a path a page sends.
    const found = (await workspacesIn(await runInMain(loadLibrary))).find(
      (one) => one.name === name,
    );

    if (found === undefined || host.switching() || found.path === host.current()) return false;

    return switchTo(found.path);
  });
  ipcMain.handle(
    NEW_WORKSPACE_CHANNEL,
    async (event, input): Promise<CreateFailure | undefined> => {
      assertFromApp(event);

      const name = Option.getOrUndefined(decodeWorkspaceName(input));

      if (name === undefined) return { kind: "invalid" };

      try {
        const prepared = await prepareWorkspaceFolder(await runInMain(loadLibrary), name, false);

        if (prepared.kind === "taken") return { kind: "taken" };

        // A switch that fails has said why in a dialog already.
        return (await switchTo(prepared.path)) ? undefined : { kind: "failed", message: "" };
      } catch (error) {
        return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  return { choose };
}
