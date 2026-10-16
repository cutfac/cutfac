import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { CutfacDesktop } from "../web/src/desktop.ts";
import {
  EDIT_COMMAND_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  PICK_PATH_CHANNEL,
  REVEAL_PATH_CHANNEL,
  SET_LOCALE_CHANNEL,
} from "./ipc.ts";

const SYSTEM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

const bridge = {
  openWorkspace: (): Promise<boolean> => ipcRenderer.invoke(OPEN_WORKSPACE_CHANNEL),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke(REVEAL_PATH_CHANNEL, target),
  pickPath: (): Promise<string | undefined> => ipcRenderer.invoke(PICK_PATH_CHANNEL),
  setLocale: (locale) => ipcRenderer.send(SET_LOCALE_CHANNEL, locale),
  onEditCommand: (listener) => {
    // Only the main process sends on this channel, but check what arrives all the same.
    const forward = (_event: IpcRendererEvent, command: string) => {
      if (command === "undo" || command === "redo") listener(command);
    };

    ipcRenderer.on(EDIT_COMMAND_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(EDIT_COMMAND_CHANNEL, forward);
    };
  },
  platform: `${SYSTEM_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
} satisfies CutfacDesktop;

contextBridge.exposeInMainWorld("cutfacDesktop", bridge);
