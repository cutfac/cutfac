import { contextBridge, ipcRenderer } from "electron";

import type { FactoryDesktop } from "../web/src/desktop.ts";
import { OPEN_WORKSPACE_CHANNEL, REVEAL_PATH_CHANNEL, SET_LOCALE_CHANNEL } from "./ipc.ts";

const SYSTEM_NAMES: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "macOS",
  linux: "Linux",
  win32: "Windows",
};

const bridge = {
  openWorkspace: (): Promise<boolean> => ipcRenderer.invoke(OPEN_WORKSPACE_CHANNEL),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke(REVEAL_PATH_CHANNEL, target),
  setLocale: (locale) => ipcRenderer.send(SET_LOCALE_CHANNEL, locale),
  platform: `${SYSTEM_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
} satisfies FactoryDesktop;

contextBridge.exposeInMainWorld("factoryDesktop", bridge);
