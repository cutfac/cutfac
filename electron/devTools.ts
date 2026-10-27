import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import { Option, Schema } from "effect";
import { BrowserWindow, ipcMain, session, shell, type IpcMainInvokeEvent } from "electron";

import type { AgentName } from "../src/core/schema.ts";
import type { AgentFix, DevState, OnboardingStep } from "../web/src/desktop.ts";
import { ONBOARDING_STEPS, originOf } from "./boardPages.ts";
import { DEV_APP } from "./devApp.ts";
import {
  checksAgents,
  fakeFix,
  fakeFixLines,
  freshFolderName,
  NO_FAKES,
  withFakes,
} from "./devFakes.ts";
import {
  ACCESS_GRANTED_CHANNEL,
  DEV_BUILD_FLAG,
  DEV_OPEN_STEP_CHANNEL,
  DEV_RESTORE_CHANNEL,
  DEV_REVEAL_CHANNEL,
  DEV_SET_FAKES_CHANNEL,
  DEV_START_OVER_CHANNEL,
  DEV_STATE_CHANGED_CHANNEL,
  DEV_STATE_CHANNEL,
  DEV_TOOLS_FLAG,
  OPEN_DEV_PANEL_CHANNEL,
} from "./ipc.ts";
import { WORKSPACES } from "./library.ts";
import { lockNavigation } from "./navigation.ts";
import { macChecks, type OnboardingChecks } from "./onboarding.ts";
import { sandboxed } from "./permissions.ts";
import { runInMain } from "./runtime.ts";
import {
  loadLibrary,
  loadOnboarding,
  loadWorkspace,
  restoreSettings,
  setSettingsAside,
  settingsFile,
  settingsSetAside,
} from "./settings.ts";
import { agentSetups, fixAgent, stopFixes } from "./sidecarRuntime.ts";
import { hasPermission } from "./systemAccess.ts";

const PANEL_SIZE = { width: 420, height: 760 };

/** How long a faked fix takes between the lines it prints. */
const FAKE_LINE_MS = 600;

const Fake = Schema.Literals(["real", "missing", "outdated", "signedOut", "ready"]);

const decodeFakes = Schema.decodeUnknownOption(
  Schema.Struct({
    agents: Schema.Struct({ claude: Fake, codex: Fake }),
    fixesFail: Schema.Boolean,
    access: Schema.Literals(["real", "granted", "denied"]),
    freshFolder: Schema.Boolean,
  }),
);

const isStep = Schema.is(Schema.Literals(ONBOARDING_STEPS));

const isText = Schema.is(Schema.String);

export interface DevToolsHost {
  boardUrl: string;
  preload: string;
  window: () => BrowserWindow | undefined;
  /** Closes the workspace and shows the first launch on `step`. */
  showOnboarding: (step: OnboardingStep) => Promise<void>;
  /** Opens a workspace, or says why it couldn't. Resolves false if it didn't open. */
  activate: (workspace: string) => Promise<boolean>;
}

export interface DevTools {
  /** Opens the panel, or brings it to the front. */
  open: () => void;
  /** What the first launch finds on this Mac, with the panel's fakes swapped in. */
  checks: OnboardingChecks;
  /** For the board's window, whose preload script then adds a way into the panel. */
  boardArguments: string[];
}

/**
 * The dev build's Dev Panel: a window of its own, beside the app's, to set the app back to a new
 * user's and to fake what the first launch finds on this Mac, so every path through it can be tried.
 * The fakes last until the app quits.
 */
export function handleDevTools(host: DevToolsHost): DevTools {
  let panel: BrowserWindow | undefined;
  let fakes = NO_FAKES;
  let freshName: string | undefined;

  /** A faked agent's fix prints a few lines, then fails or leaves the agent ready. */
  const fix = async (agent: AgentName, onLine: (line: string) => void): Promise<AgentFix> => {
    const fake = fakes.agents[agent];

    if (fake === "real") return fixAgent(agent, onLine);

    if (fake === "ready") throw new Error(`Nothing to fix for ${agent}`);

    for (const line of fakeFixLines(agent, fake)) {
      onLine(line);
      await sleep(FAKE_LINE_MS);
    }

    const command = fakeFix(agent, fake);

    if (fakes.fixesFail) return { ok: false, command };

    fakes = { ...fakes, agents: { ...fakes.agents, [agent]: "ready" } };
    sendState();

    return { ok: true, command };
  };

  const checks: OnboardingChecks = {
    agentSetups: async () =>
      withFakes(checksAgents(fakes) ? await agentSetups() : [], fakes.agents),
    fixAgent: fix,
    hasPermission: (permission) =>
      fakes.access === "real"
        ? runInMain(hasPermission(permission))
        : Promise.resolve(fakes.access === "granted"),
    suggestion: async () => {
      if (!fakes.freshFolder) return macChecks.suggestion();

      // A new workspace each run, named for when it was made, in the dev build's own folder.
      freshName ??= freshFolderName(new Date());

      return { library: await runInMain(loadLibrary), name: freshName };
    },
  };

  /** Where the first workspace would go now, for the panel to show. */
  const suggestedFolder = async () => {
    const { library, name } = await checks.suggestion();

    return name === undefined ? library : path.join(library, WORKSPACES, name);
  };

  const state = async (): Promise<DevState> => ({
    fakes,
    settingsFile: await runInMain(settingsFile),
    setAside: await runInMain(settingsSetAside),
    workspace: Option.getOrUndefined(await runInMain(loadWorkspace)),
    defaultFolder: await suggestedFolder(),
    // Only the dev runner's copy of Electron has a bundle id of its own; macOS keeps its permissions
    // by it.
    bundleId: process.env.CUTFAC_DEV_URL ? DEV_APP.bundleId : "com.github.Electron",
  });

  /** The panel shows what the app found meanwhile, such as a fix that made an agent ready. */
  const sendState = () => {
    if (panel && !panel.isDestroyed()) panel.webContents.send(DEV_STATE_CHANGED_CHANNEL);
  };

  const fromPanel = (event: IpcMainInvokeEvent) => {
    if (panel === undefined || event.sender !== panel.webContents) {
      throw new Error("Untrusted IPC sender");
    }
  };

  ipcMain.handle(DEV_STATE_CHANNEL, (event) => {
    fromPanel(event);

    return state();
  });
  ipcMain.handle(DEV_SET_FAKES_CHANNEL, (event, next) => {
    fromPanel(event);

    const decoded = Option.getOrUndefined(decodeFakes(next));

    if (decoded === undefined) throw new Error("Unknown fakes");

    const granted = fakes.access !== "granted" && decoded.access === "granted";

    fakes = decoded;

    if (!fakes.freshFolder) freshName = undefined;

    // As if the user turned both on in System Settings: the access step moves on by itself.
    if (granted) {
      for (const permission of ["screen", "accessibility"] as const) {
        host.window()?.webContents.send(ACCESS_GRANTED_CHANNEL, permission);
      }
    }

    return state();
  });
  ipcMain.handle(DEV_START_OVER_CHANNEL, async (event) => {
    fromPanel(event);
    stopFixes();
    await runInMain(setSettingsAside);
    freshName = undefined;

    const shown = originOf(host.window()?.webContents.getURL() ?? "");
    const board = originOf(host.boardUrl);

    await host.showOnboarding("welcome");

    // The board keeps what it has shown in storage by its origin: whether the Learn hint was
    // seen, the layout, the language. A new user has none of it.
    const origins = new Set([...Option.toArray(board), ...Option.toArray(shown)]);

    for (const origin of origins) await session.defaultSession.clearStorageData({ origin });

    host.window()?.webContents.reload();
  });
  ipcMain.handle(DEV_RESTORE_CHANNEL, async (event) => {
    fromPanel(event);
    stopFixes();
    await runInMain(restoreSettings);
    freshName = undefined;

    const saved = Option.getOrUndefined(await runInMain(loadWorkspace));

    if (saved !== undefined && (await host.activate(saved))) return;

    await host.showOnboarding(Option.getOrElse(await runInMain(loadOnboarding), () => "welcome"));
  });
  ipcMain.handle(DEV_OPEN_STEP_CHANNEL, (event, step) => {
    fromPanel(event);

    if (!isStep(step)) throw new Error("Unknown step");

    freshName = undefined;

    return host.showOnboarding(step);
  });
  ipcMain.handle(DEV_REVEAL_CHANNEL, (event, target) => {
    fromPanel(event);

    if (isText(target) && path.isAbsolute(target)) shell.showItemInFolder(target);
  });

  const open = () => {
    if (panel) {
      panel.show();
      panel.focus();

      return;
    }

    const created = new BrowserWindow({
      ...PANEL_SIZE,
      minWidth: 360,
      minHeight: 480,
      title: "Dev Panel",
      titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
      trafficLightPosition: { x: 18, y: 18 },
      backgroundColor: "#0a0a0a",
      webPreferences: sandboxed(host.preload, [DEV_TOOLS_FLAG]),
    });

    created.on("closed", () => {
      if (panel === created) panel = undefined;
    });
    created.on("page-title-updated", (event) => event.preventDefault());
    lockNavigation(created.webContents);
    void created.loadURL(new URL("#/dev", host.boardUrl).href);
    panel = created;
  };

  // The board's sidebar has a row for it too, to open it in a click.
  ipcMain.on(OPEN_DEV_PANEL_CHANNEL, (event) => {
    if (event.sender === host.window()?.webContents) open();
  });

  return { open, checks, boardArguments: [DEV_BUILD_FLAG] };
}
