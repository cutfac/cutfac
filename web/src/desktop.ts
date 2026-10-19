import type { Locale } from "./i18n/locale.ts";

export type EditCommand = "undo" | "redo";

/**
 * What the update server said about a license key: `granted` reaches updates, `invalid` names no
 * license, `ended` names one whose plan has ended, and `unavailable` means it couldn't be asked.
 */
export type LicenseCheck = "granted" | "invalid" | "ended" | "unavailable";

/**
 * Why the app is locked: no key saved, a key that names no license, an ended trial or plan, or no
 * word from cutfac.com for a week. The app's own copy of this lives outside the board.
 */
export type LicenseLock = "missing" | "invalid" | "ended" | "offline";

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
  /** Tell the app which language the board shows, so its menus and dialogs match. */
  setLocale: (locale: Locale) => void;
  /** Undo and Redo chosen from the app menu or its shortcuts. Returns an unsubscribe. */
  onEditCommand: (listener: (command: EditCommand) => void) => () => void;
  /**
   * Check a license key with cutfac.com and keep it to open the app and get updates, unless it is
   * invalid. Resolves what cutfac.com said.
   */
  setLicenseKey: (key: string) => Promise<LicenseCheck>;
  /** Why the app is locked, or undefined while it is open. */
  licenseLock: () => Promise<LicenseLock | undefined>;
  /** The app locked, unlocked, or locked for another reason. Returns an unsubscribe. */
  onLicenseLock: (listener: (lock: LicenseLock | undefined) => void) => () => void;
  /** Ask cutfac.com again about the saved key. Resolves the lock after. */
  recheckLicense: () => Promise<LicenseLock | undefined>;
  /**
   * License Key… chosen from the app menu, or asked for by an update check. `saved` says whether a
   * key is kept already. Returns an unsubscribe.
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
