import { realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";

import type { EditCommand } from "../web/src/desktop.ts";
import { isLocale, resolveLocale, type Locale } from "../web/src/i18n/locale.ts";
import {
  EDIT_COMMAND_CHANNEL,
  OPEN_WORKSPACE_CHANNEL,
  REVEAL_PATH_CHANNEL,
  SET_LOCALE_CHANNEL,
} from "./ipc.ts";
import { MESSAGES } from "./messages.ts";
import {
  loadLocale,
  loadPort,
  loadWorkspace,
  saveLocale,
  savePort,
  saveWorkspace,
} from "./settings.ts";
import { probePort, startSidecar, type Sidecar } from "./sidecar.ts";

// Dev with live reload: load the Vite server and run the sidecar on the port Vite proxies to.
const devUrl = process.env.FACTORY_DEV_URL || undefined;

const devPort = Number.parseInt(process.env.FACTORY_PORT ?? "4317", 10);

const preloadPath = fileURLToPath(new URL("./preload.cjs", import.meta.url));

let window: BrowserWindow | undefined;

let sidecar: Sidecar | undefined;

let workspaceRoot: string | undefined;

let appOrigin = "";

let switching = false;

let quitting = false;

let locale: Locale = "en";

// Keeps the same userData folder whether packaged or not, so the saved workspace is shared.
app.setName("Content Factory");

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!window) return;

    if (window.isMinimized()) window.restore();

    window.focus();
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    quitting = true;

    if (!sidecar) return;

    // Hold the quit until the server is gone, then quit again with nothing left to stop.
    event.preventDefault();
    void sidecar.stop().finally(() => {
      sidecar = undefined;
      app.quit();
    });
  });

  // Last resort so a crash in this process never leaves the server behind.
  process.on("exit", () => sidecar?.kill());
  process.on("SIGTERM", () => app.quit());
  process.on("SIGINT", () => app.quit());

  ipcMain.handle(OPEN_WORKSPACE_CHANNEL, (event) => {
    assertFromApp(event);

    return chooseWorkspace();
  });
  ipcMain.handle(REVEAL_PATH_CHANNEL, (event, target: string) => {
    assertFromApp(event);

    return revealInWorkspace(target);
  });
  ipcMain.on(SET_LOCALE_CHANNEL, (event, next) => {
    if (!isFromApp(event) || !isLocale(next) || next === locale) return;

    locale = next;
    Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));
    void saveLocale(next);
  });

  void app.whenReady().then(boot);
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function isFromApp(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const sender = event.senderFrame?.url;

  return sender !== undefined && new URL(sender).origin === appOrigin;
}

function assertFromApp(event: IpcMainInvokeEvent): void {
  if (!isFromApp(event)) throw new Error("Untrusted IPC sender");
}

async function boot(): Promise<void> {
  locale = (await loadLocale()) ?? resolveLocale(undefined, app.getPreferredSystemLanguages());
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));

  let workspace = (await loadWorkspace()) ?? (await pickWorkspace());

  while (workspace) {
    if ((await activate(workspace)) || quitting) return;

    workspace = await pickWorkspace();
  }

  app.quit();
}

function sendEditCommand(command: EditCommand): void {
  window?.webContents.send(EDIT_COMMAND_CHANNEL, command);
}

/** The standard menus, spelled out so every label can follow the board's language. */
function menuTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const t = MESSAGES[locale];
  const separator = { type: "separator" } as const;
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      role: "appMenu",
      submenu: [
        { role: "about", label: t.about },
        separator,
        { role: "services", label: t.services },
        separator,
        { role: "hide", label: t.hide },
        { role: "hideOthers", label: t.hideOthers },
        { role: "unhide", label: t.showAll },
        separator,
        { role: "quit", label: t.quit },
      ],
    });
  }

  template.push(
    {
      label: t.file,
      submenu: [
        { label: t.openWorkspace, accelerator: "CmdOrCtrl+O", click: () => void chooseWorkspace() },
        separator,
        isMac ? { role: "close", label: t.closeWindow } : { role: "quit", label: t.quit },
      ],
    },
    {
      label: t.edit,
      submenu: [
        // The board decides: undo the typing in a text field, or the last change to the item.
        { label: t.undo, accelerator: "CmdOrCtrl+Z", click: () => sendEditCommand("undo") },
        {
          label: t.redo,
          accelerator: isMac ? "Shift+CmdOrCtrl+Z" : "CmdOrCtrl+Y",
          click: () => sendEditCommand("redo"),
        },
        separator,
        { role: "cut", label: t.cut },
        { role: "copy", label: t.copy },
        { role: "paste", label: t.paste },
        ...(isMac ? [{ role: "pasteAndMatchStyle", label: t.pasteAndMatchStyle } as const] : []),
        { role: "delete", label: t.delete },
        { role: "selectAll", label: t.selectAll },
      ],
    },
    {
      label: t.view,
      submenu: [
        { role: "reload", label: t.reload },
        { role: "forceReload", label: t.forceReload },
        { role: "toggleDevTools", label: t.toggleDevTools },
        separator,
        { role: "resetZoom", label: t.actualSize },
        { role: "zoomIn", label: t.zoomIn },
        { role: "zoomOut", label: t.zoomOut },
        separator,
        { role: "togglefullscreen", label: t.fullScreen },
      ],
    },
    {
      role: "windowMenu",
      label: t.window,
      submenu: [
        { role: "minimize", label: t.minimize },
        { role: "zoom", label: t.zoom },
        ...(isMac
          ? [separator, { role: "front", label: t.front } as const]
          : [{ role: "close", label: t.closeWindow } as const]),
      ],
    },
  );

  return template;
}

async function pickWorkspace(): Promise<string | undefined> {
  const options = {
    properties: ["openDirectory", "createDirectory"],
    message: MESSAGES[locale].chooseWorkspace,
    defaultPath: workspaceRoot ? path.dirname(workspaceRoot) : app.getPath("documents"),
  } satisfies Electron.OpenDialogOptions;

  const result = await (window
    ? dialog.showOpenDialog(window, options)
    : dialog.showOpenDialog(options));

  return result.canceled ? undefined : result.filePaths[0];
}

/** Asks for a folder and switches to it. Resolves false if cancelled or if it failed to start. */
async function chooseWorkspace(): Promise<boolean> {
  if (switching) return false;

  const workspace = await pickWorkspace();

  if (!workspace) return false;

  const previous = workspaceRoot;

  if (await activate(workspace)) return true;

  if (previous) await activate(previous);

  return false;
}

/** Replaces the running server with one on `workspace`, then points the window at it. */
async function activate(workspace: string): Promise<boolean> {
  switching = true;

  try {
    await sidecar?.stop();
    sidecar = undefined;

    // A fixed dev port held by a stale server fails here instead of passing the health check.
    const port = devUrl ? await probePort(devPort) : await freePort();
    const started = await startSidecar({ workspace, port, onCrash: handleCrash });

    if (quitting) {
      await started.stop();

      return false;
    }

    sidecar = started;
    workspaceRoot = workspace;
    await saveWorkspace(workspace);

    if (!devUrl) await savePort(port);

    await show(devUrl ?? started.url, path.basename(workspace));

    return true;
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: MESSAGES[locale].couldNotStart,
      detail: describeError(error),
    });

    return false;
  } finally {
    switching = false;
  }
}

/** The last port if it is still free, so the board's origin and its saved preferences stay put. */
async function freePort(): Promise<number> {
  const last = await loadPort();

  if (last !== undefined) {
    try {
      return await probePort(last);
    } catch {
      // Something else took it since; the board starts with default preferences.
    }
  }

  return probePort(0);
}

async function show(url: string, title: string): Promise<void> {
  appOrigin = new URL(url).origin;
  window ??= createWindow();
  window.setTitle(title);

  try {
    await window.loadURL(url);
  } catch (error) {
    window.show();
    throw new Error(`Could not load ${url}: ${describeError(error)}`, { cause: error });
  }
}

function createWindow(): BrowserWindow {
  const created = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  const { webContents } = created;

  created.once("ready-to-show", () => created.show());
  created.on("closed", () => {
    window = undefined;
  });
  // The title is the workspace folder, not whatever the board's <title> says.
  created.on("page-title-updated", (event) => event.preventDefault());

  webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);

    return { action: "deny" };
  });

  webContents.on("will-navigate", keepInsideApp);
  webContents.on("will-redirect", keepInsideApp);

  return created;
}

/** Page-initiated navigation (links, redirects) may not leave the app origin; web links open in the browser. */
function keepInsideApp(event: { url: string; preventDefault: () => void }): void {
  if (new URL(event.url).origin === appOrigin) return;

  event.preventDefault();
  openExternally(event.url);
}

function openExternally(url: string): void {
  if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
}

function handleCrash(message: string): void {
  sidecar = undefined;
  void dialog
    .showMessageBox({ type: "error", message: MESSAGES[locale].serverStopped, detail: message })
    .then(() => app.quit());
}

async function revealInWorkspace(target: string): Promise<void> {
  if (!workspaceRoot) throw new Error("No workspace is open");

  if (!path.isAbsolute(target)) throw new Error("Path must be absolute");

  // Resolve symlinks on both sides so /tmp/x and /private/tmp/x compare equal and links cannot escape.
  const [root, resolved] = await Promise.all([realpath(workspaceRoot), realpath(target)]);
  const relative = path.relative(root, resolved);

  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path is outside the workspace");
  }

  shell.showItemInFolder(resolved);
}
