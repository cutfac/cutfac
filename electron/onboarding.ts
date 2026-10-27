import { mkdir } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";
import {
  app,
  ipcMain,
  Notification,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import { AgentName } from "../src/core/schema.ts";
import type { Folder } from "../web/src/desktop.ts";
import { agentSetups, fixAgent } from "./agents.ts";
import { pickWorkspace } from "./dialogs.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  AGENTS_CHANNEL,
  APP_ICON_CHANNEL,
  CHOOSE_FOLDER_CHANNEL,
  CREATE_WORKSPACE_CHANNEL,
  DEFAULT_FOLDER_CHANNEL,
  FIX_AGENT_CHANNEL,
  FIX_OUTPUT_CHANNEL,
  PERMISSION_CHANNEL,
  DRAFT_CHANNEL,
  SAVE_DRAFT_CHANNEL,
  CLEAR_DRAFT_CHANNEL,
  SYSTEM_VERSION_CHANNEL,
  ASK_NOTIFICATIONS_CHANNEL,
  OPEN_ACCESS_SETTINGS_CHANNEL,
  START_APP_DRAG_CHANNEL,
  FOCUS_DRAG_HELPER_CHANNEL,
} from "./ipc.ts";
import { clearDraft, isDraft, loadDraft, saveDraft } from "./settings.ts";
import {
  appBadge,
  dragApp,
  focusHelper,
  hasPermission,
  isPermission,
  openAccessSettings,
  systemVersion,
} from "./systemAccess.ts";

const isAgentName = Schema.is(AgentName);

const isText = Schema.is(Schema.String);

const isSample = Schema.is(Schema.Struct({ title: Schema.String, body: Schema.String }));

/** A folder as the workspace step shows it, from the home folder when it is inside it. */
function folder(target: string): Folder {
  const home = app.getPath("home");
  const relative = path.relative(home, target);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);

  return { path: target, label: inside ? path.join("~", relative) : target };
}

/** What the steps find and run on this Mac. The dev build can stand in for each, to try them all. */
export interface OnboardingChecks {
  agentSetups: typeof agentSetups;
  fixAgent: typeof fixAgent;
  hasPermission: typeof hasPermission;
  /** Where the workspace step suggests making one. It isn't checked: looking in Documents has macOS ask. */
  defaultFolder: () => string;
}

export const macChecks: OnboardingChecks = {
  agentSetups,
  fixAgent,
  hasPermission,
  defaultFolder: () => path.join(app.getPath("documents"), "Cutfac"),
};

export interface OnboardingHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The board's address before there is a workspace, where the helper window's page is. */
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  bringToFront: () => void;
  /** What the folder dialog says, in the board's language. */
  chooseMessage: () => string;
  /** Starts the workspace and opens the board on it. Throws why it couldn't. */
  openWorkspace: (folder: string) => Promise<void>;
  checks?: OnboardingChecks | undefined;
}

/** Answers the first launch's steps, which come before there is a workspace and so a server. */
export function handleOnboarding(host: OnboardingHost): void {
  const checks = host.checks ?? macChecks;

  // Only a folder the step was given here may be made into a workspace, never any path a page sends.
  const offered = new Set<string>();

  const offer = (target: string): Folder => {
    offered.add(target);

    return folder(target);
  };

  const assertFromApp = (event: IpcMainInvokeEvent) => {
    if (!host.isFromApp(event)) throw new Error("Untrusted IPC sender");
  };

  ipcMain.handle(AGENTS_CHANNEL, (event) => {
    assertFromApp(event);

    return checks.agentSetups();
  });
  ipcMain.handle(FIX_AGENT_CHANNEL, (event, agent) => {
    assertFromApp(event);

    if (!isAgentName(agent)) throw new Error("Unknown agent");

    return checks.fixAgent(agent, (line) => {
      if (!event.sender.isDestroyed()) event.sender.send(FIX_OUTPUT_CHANNEL, agent, line);
    });
  });
  ipcMain.handle(DRAFT_CHANNEL, (event) => {
    assertFromApp(event);

    return loadDraft();
  });
  ipcMain.handle(SAVE_DRAFT_CHANNEL, (event, draft) => {
    assertFromApp(event);

    if (!isDraft(draft)) throw new Error("Unknown draft");

    return saveDraft(draft);
  });
  ipcMain.handle(CLEAR_DRAFT_CHANNEL, (event) => {
    assertFromApp(event);

    return clearDraft();
  });
  ipcMain.handle(SYSTEM_VERSION_CHANNEL, (event) => {
    assertFromApp(event);

    return systemVersion();
  });
  ipcMain.handle(PERMISSION_CHANNEL, (event, permission) => {
    assertFromApp(event);

    if (!isPermission(permission)) throw new Error("Unknown permission");

    return checks.hasPermission(permission);
  });
  ipcMain.handle(ASK_NOTIFICATIONS_CHANNEL, (event, sample) => {
    assertFromApp(event);

    if (!isSample(sample)) throw new Error("Unknown notification");

    if (Notification.isSupported()) new Notification(sample).show();
  });
  ipcMain.handle(OPEN_ACCESS_SETTINGS_CHANNEL, (event, permission) => {
    assertFromApp(event);

    if (!isPermission(permission)) throw new Error("Unknown permission");

    return openAccessSettings({
      permission,
      boardUrl: host.boardUrl,
      preload: host.preload,
      onGranted: () => {
        // System Settings is in front; the app comes back on the step that waited for it.
        app.focus({ steal: true });
        host.bringToFront();
        host.window()?.webContents.send(ACCESS_GRANTED_CHANNEL, permission);
      },
    });
  });
  ipcMain.on(FOCUS_DRAG_HELPER_CHANNEL, (event) => {
    if (host.isFromApp(event)) focusHelper();
  });
  ipcMain.on(START_APP_DRAG_CHANNEL, (event) => {
    if (host.isFromApp(event)) dragApp(event.sender);
  });
  ipcMain.handle(APP_ICON_CHANNEL, (event) => {
    assertFromApp(event);

    return appBadge();
  });
  ipcMain.handle(DEFAULT_FOLDER_CHANNEL, (event) => {
    assertFromApp(event);

    return offer(checks.defaultFolder());
  });
  ipcMain.handle(CHOOSE_FOLDER_CHANNEL, async (event) => {
    assertFromApp(event);

    const chosen = await pickWorkspace(host.window(), host.chooseMessage(), undefined);

    return chosen === undefined ? undefined : offer(chosen);
  });
  ipcMain.handle(CREATE_WORKSPACE_CHANNEL, async (event, target) => {
    assertFromApp(event);

    if (!isText(target) || !offered.has(target)) return "Choose a folder first";

    try {
      await mkdir(target, { recursive: true });
      await host.openWorkspace(target);

      return undefined;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  });
}
