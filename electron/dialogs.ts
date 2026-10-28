import path from "node:path";

import { Effect, Option } from "effect";
import { app, dialog, type BrowserWindow, type OpenDialogOptions } from "electron";

const pickOne = (owner: BrowserWindow | undefined, options: OpenDialogOptions) =>
  Effect.map(
    Effect.promise(() =>
      owner ? dialog.showOpenDialog(owner, options) : dialog.showOpenDialog(options),
    ),
    (result) =>
      result.canceled ? Option.none<string>() : Option.fromNullishOr(result.filePaths[0]),
  );

/** Asks for a workspace folder, starting beside the open workspace or else in Documents. */
export const pickWorkspace = (
  owner: BrowserWindow | undefined,
  message: string,
  current: Option.Option<string>,
) =>
  pickOne(owner, {
    properties: ["openDirectory", "createDirectory"],
    message,
    defaultPath: Option.match(current, {
      onNone: () => app.getPath("documents"),
      onSome: (workspace) => path.dirname(workspace),
    }),
  });

/**
 * Asks for a folder or file for agents to read. macOS lets one dialog pick either; elsewhere it
 * picks a folder, and a file can still be typed or pasted in the chat.
 */
export const pickSource = (owner: BrowserWindow | undefined, message: string) =>
  pickOne(owner, { properties: ["openDirectory", "openFile"], message });

/** Says the app couldn't start, with what went wrong under it. */
export const showStartFailure = (message: string, detail: string) =>
  Effect.asVoid(Effect.promise(() => dialog.showMessageBox({ type: "error", message, detail })));
