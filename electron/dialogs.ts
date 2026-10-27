import path from "node:path";

import { app, dialog, type BrowserWindow } from "electron";

/** Shows an open dialog over `owner` when there is one. Resolves undefined if cancelled. */
async function pickOne(
  owner: BrowserWindow | undefined,
  options: Electron.OpenDialogOptions,
): Promise<string | undefined> {
  const result = await (owner
    ? dialog.showOpenDialog(owner, options)
    : dialog.showOpenDialog(options));

  return result.canceled ? undefined : result.filePaths[0];
}

/** Asks for a workspace folder, starting beside the open workspace or else in Documents. */
export function pickWorkspace(
  owner: BrowserWindow | undefined,
  message: string,
  current: string | undefined,
): Promise<string | undefined> {
  return pickOne(owner, {
    properties: ["openDirectory", "createDirectory"],
    message,
    defaultPath: current ? path.dirname(current) : app.getPath("documents"),
  });
}

/** Asks for the app's own folder, where its workspaces go, starting in Movies. */
export function pickLibrary(
  owner: BrowserWindow | undefined,
  message: string,
): Promise<string | undefined> {
  return pickOne(owner, {
    properties: ["openDirectory", "createDirectory"],
    message,
    defaultPath: app.getPath("videos"),
  });
}

/**
 * Asks for a folder or file for agents to read. macOS lets one dialog pick either; elsewhere it
 * picks a folder, and a file can still be typed or pasted in the chat.
 */
export function pickSource(
  owner: BrowserWindow | undefined,
  message: string,
): Promise<string | undefined> {
  return pickOne(owner, { properties: ["openDirectory", "openFile"], message });
}

export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** Says the app couldn't start, with what went wrong under it. */
export async function showStartFailure(message: string, detail: string): Promise<void> {
  await dialog.showMessageBox({ type: "error", message, detail });
}
