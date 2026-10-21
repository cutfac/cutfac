import type { Locale } from "./i18n/locale.ts";

export type EditCommand = "undo" | "redo";

/** What the app menu asks of the board, beyond Undo and Redo: a dialog, the sidebar, or a page. */
export type AppCommand = "palette" | "newVideo" | "toggleSidebar" | "board" | "learn" | "templates";

/**
 * What cutfac.com said about a license key: `granted` unlocks the paid plan, `invalid` names no
 * license, `ended` names one whose plan has ended, and `unavailable` means it couldn't be asked.
 */
export type LicenseCheck = "granted" | "invalid" | "ended" | "unavailable";

/** What the Electron preload script exposes; absent when the board runs in a plain browser. */
export interface CutfacDesktop {
  /** Ask for a workspace folder and restart the local server on it. Resolves false if cancelled. */
  openWorkspace: () => Promise<boolean>;
  /** Show a workspace file or folder in Finder / Explorer. `path` is absolute. */
  revealPath: (path: string) => Promise<void>;
  /**
   * Ask for a folder or file anywhere on this computer. Resolves its absolute path, or undefined if
   * cancelled.
   */
  pickPath: () => Promise<string | undefined>;
  /**
   * Drag a workspace file out of the window, to drop a copy of it in Finder or another app. Call
   * it from a `dragstart` handler that cancels the page's own drag. `path` is from the workspace's
   * root.
   */
  startDrag: (path: string) => void;
  /** Tell the app which language the board shows, so its menus and dialogs match. */
  setLocale: (locale: Locale) => void;
  /** Undo and Redo chosen from the app menu or its shortcuts. Returns an unsubscribe. */
  onEditCommand: (listener: (command: EditCommand) => void) => () => void;
  /** A command chosen from the app menu or its shortcuts. Returns an unsubscribe. */
  onAppCommand: (listener: (command: AppCommand) => void) => () => void;
  /**
   * Check a license key with cutfac.com and keep it to unlock the paid plan, unless it is invalid.
   * Resolves what cutfac.com said.
   */
  setLicenseKey: (key: string) => Promise<LicenseCheck>;
  /**
   * The paid plan unlocked or ran out, so the plan the board shows is stale. Returns an
   * unsubscribe.
   */
  onLicenseChange: (listener: () => void) => () => void;
  /** Ask the app for its license key dialog, as License Key… in its menu does. */
  requestLicenseKey: () => void;
  /**
   * License Key… chosen from the app menu, or asked for by the board. `saved` says whether a key
   * is kept already. Returns an unsubscribe.
   */
  onLicenseKeyRequest: (listener: (saved: boolean) => void) => () => void;
  /** The operating system and its version, such as `macOS 15.4.0`. */
  platform: string;
}

declare global {
  interface Window {
    cutfacDesktop?: CutfacDesktop;
  }
}

export const desktop: CutfacDesktop | undefined = window.cutfacDesktop;

const macApp = desktop?.platform.startsWith("macOS") ?? false;

/**
 * The macOS app hides its title bar and keeps the window controls over the board's top-left
 * corner, so the board leaves a strip across its top for them and for dragging the window.
 */
export const insetTitleBar: boolean = macApp;

/**
 * The macOS app draws the system's translucent sidebar material behind the whole window, so the
 * board leaves its own background off and the sidebar shows the desktop through it, blurred.
 */
export const vibrantSidebar: boolean = macApp;
