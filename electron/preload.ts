import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

import type { AgentName } from "../src/core/schema.ts";
import type {
  AppCommand,
  CutfacDesktop,
  CutfacDevTools,
  CutfacOnboarding,
  NewVideoLink,
  Permission,
} from "../web/src/desktop.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  AGENTS_CHANNEL,
  APP_COMMAND_CHANNEL,
  APP_ICON_CHANNEL,
  ATTENTION_CHANNEL,
  CHOOSE_FOLDER_CHANNEL,
  CREATE_WORKSPACE_CHANNEL,
  DEFAULT_FOLDER_CHANNEL,
  DEV_BUILD_FLAG,
  DEV_OPEN_STEP_CHANNEL,
  DEV_RESTORE_CHANNEL,
  DEV_REVEAL_CHANNEL,
  DEV_SET_FAKES_CHANNEL,
  DEV_START_OVER_CHANNEL,
  DEV_STATE_CHANGED_CHANNEL,
  DEV_STATE_CHANNEL,
  DEV_TOOLS_FLAG,
  EDIT_COMMAND_CHANNEL,
  FIX_AGENT_CHANNEL,
  FIX_OUTPUT_CHANNEL,
  PERMISSION_CHANNEL,
  ASK_NOTIFICATIONS_CHANNEL,
  LICENSE_CHANGE_CHANNEL,
  LICENSE_KEY_REQUEST_CHANNEL,
  NEW_VIDEO_LINK_CHANNEL,
  NEW_VIDEO_LINK_WAITING_CHANNEL,
  OPEN_ACCESS_SETTINGS_CHANNEL,
  OPEN_DEV_PANEL_CHANNEL,
  OPEN_LICENSE_KEY_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  PICK_PATH_CHANNEL,
  REVEAL_PATH_CHANNEL,
  SET_LICENSE_KEY_CHANNEL,
  SET_LOCALE_CHANNEL,
  START_APP_DRAG_CHANNEL,
  FOCUS_DRAG_HELPER_CHANNEL,
  START_DRAG_CHANNEL,
  TAKE_NEW_VIDEO_LINK_CHANNEL,
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

/** Every agent the app runs, to check what a fix's output names by name. */
const AGENT_NAMES: Record<AgentName, true> = { claude: true, codex: true };

const isAgentName = (agent: string): agent is AgentName => Object.hasOwn(AGENT_NAMES, agent);

const onboarding = {
  agents: () => ipcRenderer.invoke(AGENTS_CHANNEL),
  fixAgent: (agent) => ipcRenderer.invoke(FIX_AGENT_CHANNEL, agent),
  onFixOutput: (listener) => {
    const forward = (_event: IpcRendererEvent, agent: string, line: string) => {
      if (isAgentName(agent)) listener(agent, line);
    };

    ipcRenderer.on(FIX_OUTPUT_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(FIX_OUTPUT_CHANNEL, forward);
    };
  },
  permission: (permission) => ipcRenderer.invoke(PERMISSION_CHANNEL, permission),
  askNotifications: (sample) => ipcRenderer.invoke(ASK_NOTIFICATIONS_CHANNEL, sample),
  openAccessSettings: (permission) => ipcRenderer.invoke(OPEN_ACCESS_SETTINGS_CHANNEL, permission),
  onAccessGranted: (listener) => {
    const forward = (_event: IpcRendererEvent, permission: Permission) => listener(permission);

    ipcRenderer.on(ACCESS_GRANTED_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(ACCESS_GRANTED_CHANNEL, forward);
    };
  },
  startAppDrag: () => ipcRenderer.send(START_APP_DRAG_CHANNEL),
  focusDragHelper: () => ipcRenderer.send(FOCUS_DRAG_HELPER_CHANNEL),
  appIcon: () => ipcRenderer.invoke(APP_ICON_CHANNEL),
  defaultFolder: () => ipcRenderer.invoke(DEFAULT_FOLDER_CHANNEL),
  chooseFolder: () => ipcRenderer.invoke(CHOOSE_FOLDER_CHANNEL),
  createWorkspace: (folder) => ipcRenderer.invoke(CREATE_WORKSPACE_CHANNEL, folder),
} satisfies CutfacOnboarding;

/** The Dev Panel's tools; the dev build passes the flag to that window alone. */
const dev = {
  state: () => ipcRenderer.invoke(DEV_STATE_CHANNEL),
  setFakes: (fakes) => ipcRenderer.invoke(DEV_SET_FAKES_CHANNEL, fakes),
  onStateChange: (listener) => {
    const forward = () => listener();

    ipcRenderer.on(DEV_STATE_CHANGED_CHANNEL, forward);

    return () => {
      ipcRenderer.removeListener(DEV_STATE_CHANGED_CHANNEL, forward);
    };
  },
  startOver: () => ipcRenderer.invoke(DEV_START_OVER_CHANNEL),
  restore: () => ipcRenderer.invoke(DEV_RESTORE_CHANNEL),
  openStep: (step) => ipcRenderer.invoke(DEV_OPEN_STEP_CHANNEL, step),
  reveal: (target) => ipcRenderer.invoke(DEV_REVEAL_CHANNEL, target),
} satisfies CutfacDevTools;

const bridge = {
  openWorkspace: (): Promise<boolean> => ipcRenderer.invoke(OPEN_WORKSPACE_CHANNEL),
  revealPath: (target: string): Promise<void> => ipcRenderer.invoke(REVEAL_PATH_CHANNEL, target),
  pickPath: (): Promise<string | undefined> => ipcRenderer.invoke(PICK_PATH_CHANNEL),
  startDrag: (target) => ipcRenderer.send(START_DRAG_CHANNEL, target),
  setLocale: (locale) => ipcRenderer.send(SET_LOCALE_CHANNEL, locale),
  setAttention: (attention) => ipcRenderer.send(ATTENTION_CHANNEL, attention),
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
  onNewVideoLink: (listener) => {
    const take = () => {
      void ipcRenderer
        .invoke(TAKE_NEW_VIDEO_LINK_CHANNEL)
        .then((link: NewVideoLink | undefined) => link !== undefined && listener(link));
    };

    ipcRenderer.on(NEW_VIDEO_LINK_CHANNEL, take);
    // The link may have come before the board was up to hear of it.
    take();

    return () => {
      ipcRenderer.removeListener(NEW_VIDEO_LINK_CHANNEL, take);
    };
  },
  onNewVideoLinkWaiting: (listener) => {
    const ask = () => {
      void ipcRenderer.invoke(NEW_VIDEO_LINK_WAITING_CHANNEL).then(listener);
    };

    ipcRenderer.on(NEW_VIDEO_LINK_CHANNEL, ask);
    ask();

    return () => {
      ipcRenderer.removeListener(NEW_VIDEO_LINK_CHANNEL, ask);
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
  onboarding,
  ...(process.argv.includes(DEV_TOOLS_FLAG) && { dev }),
  ...(process.argv.includes(DEV_BUILD_FLAG) && {
    openDevPanel: () => ipcRenderer.send(OPEN_DEV_PANEL_CHANNEL),
  }),
  platform: `${SYSTEM_NAMES[process.platform] ?? process.platform} ${process.getSystemVersion()}`,
} satisfies CutfacDesktop;

contextBridge.exposeInMainWorld("cutfacDesktop", bridge);
