import { open } from "node:fs/promises";
import path from "node:path";

import {
  app,
  BrowserWindow,
  nativeImage,
  type NativeImage,
  screen,
  shell,
  type WebContents,
} from "electron";

import { lockNavigation } from "./navigation.ts";
import { sandboxed } from "./permissions.ts";
import { type Frame, followSettingsWindow } from "./settingsWindow.ts";

/** System Settings, on the Full Disk Access list. */
const SETTINGS_URL = "x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles";

const limits = {
  pollMs: 1_000,
  /** Long enough to find the list and drag the app in; past that the board checks on focus. */
  pollForMs: 10 * 60_000,
};

const HELPER = {
  /** Wide enough for its sentence on one line, as the list it points at is. */
  width: 440,
  height: 120,
  /** The System Settings sidebar, which the panel leaves out to line up with the list beside it. */
  sidebar: 230,
  /** Between the panel and the window above it, and the screen's edges. */
  gap: 10,
};

const ICON_SIZE = { width: 256, height: 256 };

let helper: BrowserWindow | undefined;

let poll: ReturnType<typeof setInterval> | undefined;

let unfollow: (() => void) | undefined;

/** The picture the app drags as, made ahead, since a drag only starts in step with the press. */
let dragIcon: NativeImage | undefined;

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

/** The app as the Full Disk Access list will show it: its icon and its name. */
export async function appBadge(): Promise<{ icon: string; name: string }> {
  return {
    icon: (await bundleIcon()).toDataURL(),
    name: path.basename(appBundle(), ".app"),
  };
}

/**
 * Drags the app bundle out of the helper window, into the list in System Settings. It has to run
 * while the page's drag is starting, so it can't wait for anything, the drag's picture included.
 */
export function dragApp(sender: WebContents): void {
  if (dragIcon !== undefined) sender.startDrag({ file: appBundle(), icon: dragIcon });
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
  dragIcon ??= (await bundleIcon()).resize({ width: 56 });
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
  unfollow?.();
  unfollow = undefined;
  helper?.close();
  helper = undefined;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * Where the panel goes for the System Settings window at `frame`: right under it, lined up with the
 * list beside its sidebar, as PermissionFlow places its own. Kept on the screen the window is on.
 */
function helperBounds(frame: Frame): Electron.Rectangle {
  const area = screen.getDisplayMatching(frame).workArea;

  const width = Math.min(
    Math.max(HELPER.width, frame.width - HELPER.sidebar),
    area.width - HELPER.gap * 2,
  );

  return {
    x: Math.round(
      clamp(
        frame.x + HELPER.sidebar,
        area.x + HELPER.gap,
        area.x + area.width - width - HELPER.gap,
      ),
    ),
    y: Math.round(
      clamp(
        frame.y + frame.height + HELPER.gap,
        area.y + HELPER.gap,
        area.y + area.height - HELPER.height - HELPER.gap,
      ),
    ),
    width: Math.round(width),
    height: HELPER.height,
  };
}

function showHelper({ boardUrl, preload }: AccessWatch): void {
  const area = screen.getPrimaryDisplay().workArea;

  // A panel floats over System Settings and takes the drag without bringing the app's own window
  // to the front, over the list it is dragged into. Until System Settings has a window, it waits
  // at the screen's right.
  const created = new BrowserWindow({
    width: HELPER.width,
    height: HELPER.height,
    x: area.x + area.width - HELPER.width - 32,
    y: Math.round(area.y + (area.height - HELPER.height) / 2),
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
    // The board's own dark background, so its words read as they do in the app.
    backgroundColor: "#171717",
    webPreferences: sandboxed(preload),
  });

  created.once("ready-to-show", () => created.showInactive());
  // Its page closes it with window.close(); the app's own window carries on watching.
  created.on("closed", () => {
    if (helper !== created) return;

    helper = undefined;
    unfollow?.();
    unfollow = undefined;
  });
  lockNavigation(created.webContents);
  void created.loadURL(new URL("#/drag-helper", boardUrl).href);
  helper = created;

  // It follows the window as the user moves it, and stays where it was while the window is away.
  unfollow = followSettingsWindow((frame) => {
    if (frame !== null && !created.isDestroyed()) created.setBounds(helperBounds(frame));
  });
}
