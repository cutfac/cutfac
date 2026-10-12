/** What the Electron preload script exposes; absent when the board runs in a plain browser. */
export interface FactoryDesktop {
  /** Ask for a workspace folder and restart the local server on it. Resolves false if cancelled. */
  openWorkspace: () => Promise<boolean>;
  /** Show a workspace file or folder in Finder / Explorer. `path` is absolute. */
  revealPath: (path: string) => Promise<void>;
}

declare global {
  interface Window {
    factoryDesktop?: FactoryDesktop;
  }
}

export const desktop: FactoryDesktop | undefined = window.factoryDesktop;
