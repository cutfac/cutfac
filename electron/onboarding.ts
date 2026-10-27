import path from "node:path";

import { Option, Schema } from "effect";
import {
  app,
  ipcMain,
  Notification,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import { AgentName } from "../src/core/schema.ts";
import type { CreateFailure, Folder } from "../web/src/desktop.ts";
import { agentSetups, fixAgent } from "./agents.ts";
import { pickLibrary } from "./dialogs.ts";
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
  SHARING_CHANNEL,
  SYSTEM_VERSION_CHANNEL,
  ASK_NOTIFICATIONS_CHANNEL,
  OPEN_ACCESS_SETTINGS_CHANNEL,
  START_APP_DRAG_CHANNEL,
  FOCUS_DRAG_HELPER_CHANNEL,
} from "./ipc.ts";
import { decodeWorkspaceName } from "./library.ts";
import { clearDraft, isDraft, loadDraft, loadLibrary, saveDraft, saveLibrary } from "./settings.ts";
import { sharingChoice } from "./sharing.ts";
import {
  appBadge,
  dragApp,
  focusHelper,
  hasPermission,
  isPermission,
  openAccessSettings,
  systemVersion,
} from "./systemAccess.ts";
import { prepareWorkspaceFolder } from "./workspaces.ts";

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
  /** The app's folder the last step suggests, and a name for the workspace when it has one. */
  suggestion: () => Promise<{ library: string; name: string | undefined }>;
}

export const macChecks: OnboardingChecks = {
  agentSetups,
  fixAgent,
  hasPermission,
  suggestion: async () => ({ library: await loadLibrary(), name: undefined }),
};

export interface OnboardingHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The board's address before there is a workspace, where the helper window's page is. */
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  bringToFront: () => void;
  /** What the dialog for the app's folder says, in the board's language. */
  chooseMessage: () => string;
  /** Starts the workspace and opens the board on it. Throws why it couldn't. */
  openWorkspace: (folder: string) => Promise<void>;
  checks?: OnboardingChecks | undefined;
}

/** Answers the first launch's steps, which come before there is a workspace and so a server. */
export function handleOnboarding(host: OnboardingHost): void {
  const checks = host.checks ?? macChecks;

  // Only a folder the step was given here may hold the workspace, never any path a page sends.
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
  ipcMain.handle(SHARING_CHANNEL, (event) => {
    assertFromApp(event);

    return sharingChoice();
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
  ipcMain.handle(DEFAULT_FOLDER_CHANNEL, async (event) => {
    assertFromApp(event);

    const { library, name } = await checks.suggestion();

    return name === undefined ? { library: offer(library) } : { library: offer(library), name };
  });
  ipcMain.handle(CHOOSE_FOLDER_CHANNEL, async (event) => {
    assertFromApp(event);

    const chosen = await pickLibrary(host.window(), host.chooseMessage());

    return chosen === undefined ? undefined : offer(chosen);
  });
  ipcMain.handle(
    CREATE_WORKSPACE_CHANNEL,
    async (event, library, input): Promise<CreateFailure | undefined> => {
      assertFromApp(event);

      if (!isText(library) || !offered.has(library)) return { kind: "invalid" };

      const name = Option.getOrUndefined(decodeWorkspaceName(input));

      if (name === undefined) return { kind: "invalid" };

      try {
        // A workspace of that name already there is opened, as after a reinstall.
        const prepared = await prepareWorkspaceFolder(library, name, true);

        if (prepared.kind === "taken") return { kind: "taken" };

        await saveLibrary(library);
        await host.openWorkspace(prepared.path);

        return undefined;
      } catch (error) {
        return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
