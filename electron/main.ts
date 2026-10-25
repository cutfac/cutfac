import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";

import type { AppCommand, EditCommand, OnboardingStep } from "../web/src/desktop.ts";
import { isLocale, resolveLocale, type Locale } from "../web/src/i18n/locale.ts";
import { stopFixes } from "./agents.ts";
import { handleAttention } from "./attention.ts";
import { BOARD_URL, onboardingPage, onboardingStep, originOf } from "./boardPages.ts";
import { registerBoardScheme, serveBoard } from "./boardProtocol.ts";
import { handleDevTools } from "./devTools.ts";
import { describeError, pickSource, pickWorkspace, showStartFailure } from "./dialogs.ts";
import { stopWatching } from "./fullDiskAccess.ts";
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
import { startLicense, type License } from "./license.ts";
import { menuTemplate, showTextMenu } from "./menu.ts";
import { MESSAGES } from "./messages.ts";
import { keepInsideApp } from "./navigation.ts";
import { handleOnboarding } from "./onboarding.ts";
import { limitPermissions, sandboxed } from "./permissions.ts";
import { freePort, probePort } from "./ports.ts";
import {
  loadLicense,
  loadLocale,
  loadOnboarding,
  loadPage,
  loadPort,
  loadWindowPlace,
  loadWorkspace,
  saveLicense,
  saveLocale,
  saveOnboarding,
  savePage,
  savePort,
  saveWindowPlace,
  saveWorkspace,
  settingsWritten,
} from "./settings.ts";
import { boardDir, startSidecar, type Sidecar } from "./sidecar.ts";
import { startUpdates, type Updates } from "./updates.ts";
import { placeWindow, type WindowPlace } from "./windowPlace.ts";
import { dragOut, revealInWorkspace } from "./workspaceFiles.ts";

// Dev with live reload: load the Vite server and run the sidecar on the port Vite proxies to. The
// packaged app ignores it, so another program can't open the app on a page of its choosing.
const devUrl = app.isPackaged ? undefined : process.env.CUTFAC_DEV_URL || undefined;

const devPort = Number.parseInt(process.env.CUTFAC_PORT ?? "4317", 10);

const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));

/** The board before there is a workspace: the app's own copy, or Vite's in dev. */
const boardUrl = devUrl ?? BOARD_URL;

let window: BrowserWindow | undefined;

let sidecar: Sidecar | undefined;

let updates: Updates | undefined;

/** Only the packaged app checks its license key; a dev build leaves the saved one alone. */
let license: License | undefined;

let workspaceRoot: string | undefined;

let appOrigin = "";

let switching = false;

let quitting = false;

/** The server is stopped and the settings saved, so the quit may go ahead. */
let quitReady = false;

/** A move or resize waiting to be saved, so a drag saves once when it stops. */
let placeTimer: ReturnType<typeof setTimeout> | undefined;

let locale: Locale = "en";

// The Dev Panel, for trying the app as a new user would; never in the released app.
const devTools = app.isPackaged
  ? undefined
  : handleDevTools({
      boardUrl,
      preload: preloadPath,
      window: () => window,
      showOnboarding,
      activate,
    });

// Keeps the same userData folder whether packaged or not, so the saved workspace is shared.
app.setName("Cutfac");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  registerBoardScheme();
  app.on("second-instance", bringToFront);

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (quitReady) return;

    quitting = true;

    // The window closes only after this, too late for its place to reach the disk.
    if (window) rememberPlace(window);

    // Hold the quit until the server is gone and the settings saved, the first launch's step too,
    // then quit again with nothing left to stop.
    event.preventDefault();
    void Promise.allSettled([sidecar?.stop(), settingsWritten()]).then(() => {
      sidecar = undefined;
      quitReady = true;
      app.quit();
    });
  });

  // Last resort so a crash in this process never leaves the server behind.
  process.on("exit", () => {
    sidecar?.kill();
    stopFixes();
  });
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());

  // `bun run desktop:dev` rebuilt the preload script, which a reload runs in the page.
  if (devUrl) process.on("SIGUSR2", () => window?.webContents.reloadIgnoringCache());

  ipcMain.handle(OPEN_WORKSPACE_CHANNEL, (event) => {
    assertFromApp(event);

    return chooseWorkspace();
  });
  ipcMain.handle(REVEAL_PATH_CHANNEL, (event, target: string) => {
    assertFromApp(event);

    return revealInWorkspace(workspaceRoot, target);
  });
  ipcMain.on(START_DRAG_CHANNEL, (event, target: string) => {
    if (!isFromApp(event)) return;

    // A file gone since the board showed it just doesn't drag.
    dragOut(workspaceRoot, event.sender, target).catch(() => undefined);
  });
  ipcMain.handle(PICK_PATH_CHANNEL, (event) => {
    assertFromApp(event);

    return pickSource(window, MESSAGES[locale].chooseSource);
  });
  ipcMain.handle(SET_LICENSE_KEY_CHANNEL, (event, input: string) => {
    assertFromApp(event);

    return license?.setKey(input) ?? "unavailable";
  });
  ipcMain.on(OPEN_LICENSE_KEY_CHANNEL, (event) => {
    if (isFromApp(event)) requestLicenseKey();
  });
  ipcMain.on(SET_LOCALE_CHANNEL, (event, next) => {
    if (!isFromApp(event) || !isLocale(next) || next === locale) return;

    locale = next;
    setMenu();
    void saveLocale(next);
  });
  handleAttention({ isFromApp, bringToFront, sendAppCommand, locale: () => locale });
  handleOnboarding({
    isFromApp,
    boardUrl,
    preload: preloadPath,
    window: () => window,
    bringToFront,
    chooseMessage: () => MESSAGES[locale].chooseWorkspace,
    openWorkspace: async (folder) => {
      if (!(await open(folder))) throw new Error(MESSAGES[locale].couldNotStart);
    },
    checks: devTools?.checks,
  });

  void app.whenReady().then(boot);
}

/** Whether `url` is on the board shown now, as opposed to a page it linked to. */
const isAppUrl = (url: string) => originOf(url) === appOrigin;

function isFromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const sender = event.senderFrame?.url;

  return sender !== undefined && isAppUrl(sender);
}

function assertFromApp(event: IpcMainInvokeEvent): void {
  if (!isFromApp(event)) throw new Error("Untrusted IPC sender");
}

async function boot(): Promise<void> {
  limitPermissions(isAppUrl);
  // The board is dark only; this keeps the title bar, menus and dialogs dark with it.
  nativeTheme.themeSource = "dark";
  locale = (await loadLocale()) ?? resolveLocale(undefined, app.getPreferredSystemLanguages());

  if (app.isPackaged) {
    license = startLicense({
      ...(await loadLicense()),
      save: saveLicense,
      onChange: () => window?.webContents.send(LICENSE_CHANGE_CHANNEL),
    });
  }

  updates = startUpdates({ messages: () => MESSAGES[locale], window: () => window });
  setMenu();

  // In dev, Vite serves the board instead.
  if (!devUrl) serveBoard(boardDir());

  const saved = await loadWorkspace();

  if ((saved !== undefined && (await activate(saved))) || quitting) return;

  // No workspace yet, or the saved one wouldn't start: the first launch, where it was left. Someone
  // who had a workspace already has been through it, so they only choose a folder.
  const step = (await loadOnboarding()) ?? (saved === undefined ? "welcome" : "folder");

  try {
    await showOnboarding(step);
  } catch (error) {
    await showStartFailure(MESSAGES[locale].couldNotStart, describeError(error));
    app.quit();
  }
}

function setMenu(): void {
  const template = menuTemplate({
    messages: MESSAGES[locale],
    updatesEnabled: updates?.enabled ?? false,
    checkForUpdates: () => void updates?.checkNow(),
    requestLicenseKey,
    openWorkspace: () => void chooseWorkspace(),
    appCommand: sendAppCommand,
    editCommand: sendEditCommand,
    openDevTools: devTools?.open,
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function sendEditCommand(command: EditCommand): void {
  window?.webContents.send(EDIT_COMMAND_CHANNEL, command);
}

function sendAppCommand(command: AppCommand): void {
  window?.webContents.send(APP_COMMAND_CHANNEL, command);
}

function bringToFront(): void {
  if (!window) return;

  if (window.isMinimized()) window.restore();

  window.show();
  window.focus();
}

/** Has the board ask for a license key; Electron has no text field dialog of its own. */
function requestLicenseKey(): void {
  bringToFront();
  window?.webContents.send(LICENSE_KEY_REQUEST_CHANNEL, license?.hasKey() ?? false);
}

/** Asks for a folder and switches to it. Resolves false if cancelled or if it failed to start. */
async function chooseWorkspace(): Promise<boolean> {
  if (switching) return false;

  const workspace = await pickWorkspace(window, MESSAGES[locale].chooseWorkspace, workspaceRoot);

  if (!workspace) return false;

  const previous = workspaceRoot;

  if (await activate(workspace)) return true;

  if (previous) await activate(previous);

  return false;
}

/** Opens `workspace`, or says why it couldn't. Resolves false if it didn't open. */
async function activate(workspace: string): Promise<boolean> {
  try {
    return await open(workspace);
  } catch (error) {
    await showStartFailure(MESSAGES[locale].couldNotStart, describeError(error));

    return false;
  }
}

/**
 * Replaces the running server with one on `workspace`, then points the window at the page last
 * shown there. Resolves false if the app quit meanwhile; throws why it couldn't start.
 */
async function open(workspace: string): Promise<boolean> {
  switching = true;

  try {
    await sidecar?.stop();
    sidecar = undefined;

    // A fixed dev port held by a stale server fails here instead of passing the health check.
    const port = devUrl ? await probePort(devPort) : await freePort(await loadPort());

    const started = await startSidecar({
      workspace,
      port,
      onCrash: handleCrash,
      watch: devUrl !== undefined,
    });

    if (quitting) {
      await started.stop();

      return false;
    }

    sidecar = started;
    workspaceRoot = workspace;
    await saveWorkspace(workspace);

    if (!devUrl) await savePort(port);

    const page = (await loadPage(workspace)) ?? "";

    await show(new URL(page, devUrl ?? started.url).href, path.basename(workspace));

    return true;
  } finally {
    switching = false;
  }
}

/** Closes the workspace, if one is open, and shows the first launch on `step`. */
async function showOnboarding(step: OnboardingStep): Promise<void> {
  await sidecar?.stop();
  sidecar = undefined;
  workspaceRoot = undefined;
  await show(new URL(onboardingPage(step), boardUrl).href, "Cutfac");
}

async function show(url: string, title: string): Promise<void> {
  appOrigin = originOf(url) ?? "";
  window ??= createWindow(await loadWindowPlace());
  window.setTitle(title);

  try {
    await window.loadURL(url);
  } catch (error) {
    window.show();
    throw new Error(`Could not load ${url}: ${describeError(error)}`, { cause: error });
  }
}

function createWindow(place: WindowPlace | undefined): BrowserWindow {
  const workAreas = screen.getAllDisplays().map((display) => display.workArea);

  const created = new BrowserWindow({
    ...(place ? placeWindow(place, workAreas) : { width: 1280, height: 860 }),
    minWidth: 960,
    minHeight: 640,
    show: false,
    // On macOS the board draws to the top edge and leaves a strip for the window controls, as
    // Finder and Notes do, instead of sitting under a separate gray title bar.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    // macOS only; elsewhere the system title bar stays. Centred in the board's 48px title bar.
    trafficLightPosition: { x: 18, y: 18 },
    // macOS: the system's sidebar material behind the whole window, as Finder's has. The board
    // leaves its own background off there, so its sidebar shows the desktop through it, blurred.
    ...(process.platform === "darwin" && {
      vibrancy: "sidebar",
      backgroundColor: "#00000000",
    }),
    webPreferences: sandboxed(preloadPath, devTools?.boardArguments),
  });

  const { webContents } = created;

  created.once("ready-to-show", () => {
    if (place?.maximized) created.maximize();

    created.show();
  });
  created.on("focus", () => {
    license?.refresh();
    // Back from System Settings: the board checks the access itself.
    stopWatching();
  });

  const rememberSoon = () => {
    clearTimeout(placeTimer);
    placeTimer = setTimeout(() => rememberPlace(created), 500);
  };

  created.on("move", rememberSoon);
  created.on("resize", rememberSoon);
  created.on("maximize", () => rememberPlace(created));
  created.on("unmaximize", () => rememberPlace(created));
  // Quitting saved it already, before the window closed.
  created.on("close", () => {
    if (!quitting) rememberPlace(created);
  });
  created.on("closed", () => {
    window = undefined;
    stopWatching();
  });
  // The title is the workspace folder, not whatever the board's <title> says.
  created.on("page-title-updated", (event) => event.preventDefault());

  keepInsideApp(webContents, isAppUrl);
  webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) rememberPage(url);
  });
  webContents.on("context-menu", (_event, params) =>
    showTextMenu(created, params, MESSAGES[locale]),
  );

  return created;
}

/** Saves where the window is, so the next launch opens it there; one that fails is just forgotten. */
function rememberPlace(target: BrowserWindow): void {
  clearTimeout(placeTimer);

  if (target.isDestroyed()) return;

  saveWindowPlace({ ...target.getNormalBounds(), maximized: target.isMaximized() }).catch(
    () => undefined,
  );
}

/**
 * Saves the board page just opened, so the workspace opens on it next time; before there is one,
 * the first-launch step, so it picks up there.
 */
function rememberPage(url: string): void {
  // While switching, the page still shown belongs to the other workspace.
  if (!isAppUrl(url) || switching) return;

  const { hash } = new URL(url);

  if (workspaceRoot !== undefined) {
    savePage(workspaceRoot, hash).catch(() => undefined);

    return;
  }

  const step = onboardingStep(hash);

  if (step) saveOnboarding(step).catch(() => undefined);
}

function handleCrash(message: string): void {
  sidecar = undefined;
  void dialog
    .showMessageBox({ type: "error", message: MESSAGES[locale].serverStopped, detail: message })
    .then(() => app.quit());
}
