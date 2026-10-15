import type { Locale } from "./i18n/locale.ts";

export type EditCommand = "undo" | "redo";

/** What the Electron preload script exposes; absent when the board runs in a plain browser. */
export interface FactoryDesktop {
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
  /** The operating system and its version, such as `macOS 15.4.0`. */
  platform: string;
}

declare global {
  interface Window {
    factoryDesktop?: FactoryDesktop;
  }
}

export const desktop: FactoryDesktop | undefined = window.factoryDesktop;
