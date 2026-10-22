import { open } from "node:fs/promises";
import path from "node:path";

import { app, BrowserWindow, nativeImage, screen, shell, type WebContents } from "electron";

import { lockNavigation } from "./navigation.ts";
import { sandboxed } from "./permissions.ts";

/** System Settings, on the Full Disk Access list. */
const SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

const limits = {
  pollMs: 1_000,
  /** Long enough to find the list and drag the app in; past that the board checks on focus. */
  pollForMs: 10 * 60_000,
};

const HELPER_SIZE = { width: 260, height: 236 };

const ICON_SIZE = { width: 256, height: 256 };

let helper: BrowserWindow | undefined;

let poll: ReturnType<typeof setInterval> | undefined;

/** A file only Full Disk Access opens: the user's own privacy database. */
const probeFile = () =>
  path.join(app.getPath("home"), "Library", "Application Support", "com.apple.TCC", "TCC.db");

/** Whether the app may read every file. Only macOS asks; elsewhere it always may. */
export async function hasFullDiskAccess(): Promise<boolean> {
  if (process.platform !== "darwin") return true;

  try {
    await (await open(probeFile(), "r")).close();

    return true;
  } catch {
    return false;
  }
}

/** The app bundle itself, which is what the Full Disk Access list takes. */
const appBundle = () => path.resolve(app.getPath("exe"), "..", "..", "..");

/** The app's icon, large enough for the helper window to show crisp. */
async function bundleIcon(): Promise<Electron.NativeImage> {
  const bundle = appBundle();

  return nativeImage
    .createThumbnailFromPath(bundle, ICON_SIZE)
    .catch(() => app.getFileIcon(bundle, { size: "normal" }));
}

export async function appIconUrl(): Promise<string> {
  return (await bundleIcon()).toDataURL();
}

/** Drags the app bundle out of the helper window, into the list in System Settings. */
export async function dragApp(sender: WebContents): Promise<void> {
  sender.startDrag({ file: appBundle(), icon: (await bundleIcon()).resize({ width: 64 }) });
}

export interface AccessWatch {
  /** The board's address, where the helper window's page is. */
  boardUrl: string;
  preload: string;
  /** The access was granted while System Settings was open. */
  onGranted: () => void;
}

/**
 * Opens the Full Disk Access list with a small window beside it to drag the app from, and watches
 * for the access until it is granted, the user comes back to the app, or it has waited long enough.
 */
export async function openAccessSettings(watch: AccessWatch): Promise<void> {
  // Set up before the wait, so a second call meanwhile replaces this one instead of doubling it.
  stopWatching();
  showHelper(watch);

  const until = Date.now() + limits.pollForMs;

  poll = setInterval(() => {
    if (Date.now() > until) return stopWatching();

    void hasFullDiskAccess().then((granted) => {
      if (!granted || poll === undefined) return;

      stopWatching();
      watch.onGranted();
    });
  }, limits.pollMs);

  await shell.openExternal(SETTINGS_URL);
}

/** Closes the helper window and stops checking, as when the user comes back to the app. */
export function stopWatching(): void {
  clearInterval(poll);
  poll = undefined;
  helper?.close();
  helper = undefined;
}

function showHelper({ boardUrl, preload }: AccessWatch): void {
  const area = screen.getPrimaryDisplay().workArea;

  // A panel floats over System Settings and takes the drag without bringing the app's own window
  // to the front, over the list it is dragged into.
  const created = new BrowserWindow({
    ...HELPER_SIZE,
    x: area.x + area.width - HELPER_SIZE.width - 32,
    y: Math.round(area.y + (area.height - HELPER_SIZE.height) / 2),
    type: "panel",
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    acceptFirstMouse: true,
    skipTaskbar: true,
    show: false,
    vibrancy: "hud",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    webPreferences: sandboxed(preload),
  });

  created.once("ready-to-show", () => created.showInactive());
  // Its page closes it with window.close(); the app's own window carries on watching.
  created.on("closed", () => {
    if (helper === created) helper = undefined;
  });
  lockNavigation(created.webContents);
  void created.loadURL(new URL("#/drag-helper", boardUrl).href);
  helper = created;
}
