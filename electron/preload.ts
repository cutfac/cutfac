import { contextBridge, ipcRenderer } from "electron";

import type { FactoryDesktop } from "../web/src/desktop.ts";
import { OPEN_WORKSPACE_CHANNEL, REVEAL_PATH_CHANNEL } from "./ipc.ts";

const bridge = {
  openWorkspace: (): Promise<boolean> => ipcRenderer.invoke(OPEN_WORKSPACE_CHANNEL),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke(REVEAL_PATH_CHANNEL, target),
} satisfies FactoryDesktop;

contextBridge.exposeInMainWorld("factoryDesktop", bridge);
