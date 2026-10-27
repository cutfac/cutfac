import path from "node:path";

import { Effect, Option, Schema } from "effect";
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
import { firstWorkspace } from "./firstWorkspace.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  AGENTS_CHANNEL,
  APP_ICON_CHANNEL,
  CREATE_WORKSPACE_CHANNEL,
  START_WORKSPACE_CHANNEL,
  WORKSPACE_FOLDER_CHANNEL,
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
import { runInMain } from "./runtime.ts";
import { clearDraft, isDraft, loadDraft, loadLibrary, saveDraft } from "./settings.ts";
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

const isAgentName = Schema.is(AgentName);

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
  /** The app's folder for the first workspace, and a name for it when the build has one. */
  suggestion: () => Promise<{ library: string; name: string | undefined }>;
}

export const macChecks: OnboardingChecks = {
  agentSetups,
  fixAgent,
  hasPermission,
  suggestion: async () => ({ library: await runInMain(loadLibrary), name: undefined }),
};

export interface OnboardingHost {
  isFromApp: (event: IpcMainEvent | IpcMainInvokeEvent) => boolean;
  /** The board's address before there is a workspace, where the helper window's page is. */
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  bringToFront: () => void;
  /** Starts the server on a workspace without showing it. Resolves its address. */
  serve: (folder: string) => Promise<string>;
  /** Starts the workspace and opens the board on it. Throws why it couldn't. */
  openWorkspace: (folder: string) => Promise<void>;
  /** The board's language, for the agent to write in. */
  locale: () => string;
  checks?: OnboardingChecks | undefined;
}

/** Answers the first launch's steps, which come before there is a workspace and so a server. */
export function handleOnboarding(host: OnboardingHost): void {
  const checks = host.checks ?? macChecks;

  const first = firstWorkspace({
    serve: host.serve,
    agents: () => checks.agentSetups(),
    locale: host.locale,
  });

  /**
   * Makes the workspace for the answers so far, in the app's folder, named as the dev build says
   * or as the board suggests; the main process picks the place, never a page.
   */
  const start = async (given: Option.Option<string>) => {
    const draft = Option.getOrUndefined(await runInMain(loadDraft));
    const suggested = await checks.suggestion();
    const name = suggested.name ?? Option.getOrUndefined(given);

    if (draft === undefined || name === undefined) throw new Error("Say what to make first");

    const made = await first.start(suggested.library, name, draft);

    if (made === undefined) throw new Error("The workspace wasn't made");

    return made;
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

    return runInMain(Effect.map(loadDraft, Option.getOrUndefined));
  });
  ipcMain.handle(SAVE_DRAFT_CHANNEL, (event, draft) => {
    assertFromApp(event);

    if (!isDraft(draft)) throw new Error("Unknown draft");

    return runInMain(saveDraft(draft));
  });
  ipcMain.handle(CLEAR_DRAFT_CHANNEL, (event) => {
    assertFromApp(event);

    return runInMain(clearDraft);
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
  ipcMain.handle(START_WORKSPACE_CHANNEL, (event, name) => {
    assertFromApp(event);

    // It runs while the user goes on; the last step waits for it, and tries again if it failed.
    start(decodeWorkspaceName(name)).catch(() => undefined);
  });
  ipcMain.handle(WORKSPACE_FOLDER_CHANNEL, async (event) => {
    assertFromApp(event);

    const ready = await first.ready().catch(() => undefined);

    return ready === undefined ? undefined : folder(ready);
  });
  ipcMain.handle(
    CREATE_WORKSPACE_CHANNEL,
    async (event, name): Promise<CreateFailure | undefined> => {
      assertFromApp(event);

      try {
        // After a relaunch, as screen recording asks for, nothing was started in this run.
        const ready =
          (await first.ready().catch(() => undefined)) ?? (await start(decodeWorkspaceName(name)));

        await host.openWorkspace(ready);

        return undefined;
      } catch (error) {
        return { kind: "failed", message: error instanceof Error ? error.message : String(error) };
      }
    },
  );
}
