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
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions,
} from "electron";

import { OPEN_WORKSPACE_CHANNEL, REVEAL_PATH_CHANNEL } from "./ipc.ts";
import { loadWorkspace, saveWorkspace } from "./settings.ts";
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

  void app.whenReady().then(boot);
}

function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function assertFromApp(event: IpcMainInvokeEvent): void {
  const sender = event.senderFrame?.url;

  if (!sender || new URL(sender).origin !== appOrigin) throw new Error("Untrusted IPC sender");
}

async function boot(): Promise<void> {
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate()));

  let workspace = (await loadWorkspace()) ?? (await pickWorkspace());

  while (workspace) {
    if ((await activate(workspace)) || quitting) return;

    workspace = await pickWorkspace();
  }

  app.quit();
}

function menuTemplate(): MenuItemConstructorOptions[] {
  const isMac = process.platform === "darwin";
  const template: MenuItemConstructorOptions[] = [];

  if (isMac) template.push({ role: "appMenu" });

  template.push(
    {
      label: "File",
      submenu: [
        {
          label: "Open Workspace…",
          accelerator: "CmdOrCtrl+O",
          click: () => void chooseWorkspace(),
        },
        { type: "separator" },
        { role: isMac ? "close" : "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  );

  return template;
}

async function pickWorkspace(): Promise<string | undefined> {
  const options = {
    properties: ["openDirectory", "createDirectory"],
    message: "Choose or create a folder for your content workspace",
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
    const port = await probePort(devUrl ? devPort : 0);
    const started = await startSidecar({ workspace, port, onCrash: handleCrash });

    if (quitting) {
      await started.stop();

      return false;
    }

    sidecar = started;
    workspaceRoot = workspace;
    await saveWorkspace(workspace);
    await show(devUrl ?? started.url, path.basename(workspace));

    return true;
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      message: "Content Factory could not start",
      detail: describeError(error),
    });

    return false;
  } finally {
    switching = false;
  }
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
    .showMessageBox({ type: "error", message: "The local server stopped", detail: message })
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
