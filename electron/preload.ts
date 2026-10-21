import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { AppCommand, CutfacDesktop } from "../web/src/desktop.ts";
import {
  APP_COMMAND_CHANNEL,
  EDIT_COMMAND_CHANNEL,
  LICENSE_CHANGE_CHANNEL,
  LICENSE_KEY_REQUEST_CHANNEL,
  OPEN_LICENSE_KEY_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  PICK_PATH_CHANNEL,
  REVEAL_PATH_CHANNEL,
  SET_LICENSE_KEY_CHANNEL,
  SET_LOCALE_CHANNEL,
  START_DRAG_CHANNEL,
} from "./ipc.ts";

const SYSTEM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

/** Every command the menu may send, to check what arrives by name. */
const APP_COMMANDS: Record<AppCommand, true> = {
  palette: true,
  newVideo: true,
  toggleSidebar: true,
  board: true,
  learn: true,
  templates: true,
};

const isAppCommand = (command: string): command is AppCommand =>
  Object.hasOwn(APP_COMMANDS, command);

const bridge = {
  openWorkspace: (): Promise<boolean> => ipcRenderer.invoke(OPEN_WORKSPACE_CHANNEL),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke(REVEAL_PATH_CHANNEL, target),
  pickPath: (): Promise<string | undefined> => ipcRenderer.invoke(PICK_PATH_CHANNEL),
  startDrag: (target) => ipcRenderer.send(START_DRAG_CHANNEL, target),
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
  onAppCommand: (listener) => {
    const forward = (_event: IpcRendererEvent, command: string) => {
      if (isAppCommand(command)) listener(command);
    };

    ipcRenderer.on(APP_COMMAND_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(APP_COMMAND_CHANNEL, forward);
    };
  },
  setLicenseKey: (key) => ipcRenderer.invoke(SET_LICENSE_KEY_CHANNEL, key),
  onLicenseChange: (listener) => {
    const forward = () => listener();

    ipcRenderer.on(LICENSE_CHANGE_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(LICENSE_CHANGE_CHANNEL, forward);
    };
  },
  requestLicenseKey: () => ipcRenderer.send(OPEN_LICENSE_KEY_CHANNEL),
  onLicenseKeyRequest: (listener) => {
    const forward = (_event: IpcRendererEvent, saved: boolean) => listener(saved === true);

    ipcRenderer.on(LICENSE_KEY_REQUEST_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(LICENSE_KEY_REQUEST_CHANNEL, forward);
    };
  },
  platform: `${SYSTEM_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
} satisfies CutfacDesktop;

contextBridge.exposeInMainWorld("cutfacDesktop", bridge);
