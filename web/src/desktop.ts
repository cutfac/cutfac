import type { AgentName } from "./api.ts";
import type { Locale } from "./i18n/locale.ts";

export type EditCommand = "undo" | "redo";

/** What the app menu asks of the board, beyond Undo and Redo: a dialog, the sidebar, or a page. */
export type AppCommand = "palette" | "newVideo" | "toggleSidebar" | "board" | "learn" | "templates";

/**
 * What cutfac.com said about a license key: `granted` unlocks the paid plan, `invalid` names no
 * license, `ended` names one whose plan has ended, and `unavailable` means it couldn't be asked.
 */
export type LicenseCheck = "granted" | "invalid" | "ended" | "unavailable";

/**
 * An agent CLI as the first launch finds it on this computer, before there is a workspace: missing,
 * too old, signed out, or ready to run.
 */
export interface AgentSetup {
  agent: AgentName;
  state: "missing" | "outdated" | "signedOut" | "ready";
  /** The release the CLI reports, when it is installed and says. */
  version?: string;
  /** What fixes it: the installer, the update or the sign-in. None when it is ready. */
  fix?: string;
}

/** How fixing an agent went, with the command it ran for the user to run themselves if it failed. */
export interface AgentFix {
  ok: boolean;
  command: string;
}

/** The first-launch steps that come before there is a workspace. */
export type OnboardingStep = "welcome" | "agent" | "access" | "folder";

/** A folder as the workspace step shows it: its path, and the same shortened from the home folder. */
export interface Folder {
  path: string;
  label: string;
}

/** What the first launch asks of the app before there is a workspace, and so a server. */
export interface CutfacOnboarding {
  /** Every agent CLI as found on this computer now. */
  agents: () => Promise<AgentSetup[]>;
  /**
   * Run the fix the last `agents()` named for the agent: its installer, update or sign-in. Each
   * line it prints goes to `onFixOutput`.
   */
  fixAgent: (agent: AgentName) => Promise<AgentFix>;
  /** A line a fix printed. Returns an unsubscribe. */
  onFixOutput: (listener: (agent: AgentName, line: string) => void) => () => void;
  /** Whether macOS lets the app read every file, as the agents it runs need. */
  fullDiskAccess: () => Promise<boolean>;
  /**
   * Open the Full Disk Access list in System Settings, with a small window beside it to drag the
   * app from. The app comes back to the front once the access is granted.
   */
  openAccessSettings: () => Promise<void>;
  /** Full Disk Access was granted while System Settings was open. Returns an unsubscribe. */
  onAccessGranted: (listener: () => void) => () => void;
  /** Drag the app itself into the Full Disk Access list, from the helper window. */
  startAppDrag: () => void;
  /** The app's icon as a data URL, for the helper window to show as the thing to drag. */
  appIcon: () => Promise<string>;
  /** The folder the workspace step suggests. */
  defaultFolder: () => Promise<Folder>;
  /** Ask for another folder. Resolves it, or undefined if cancelled. */
  chooseFolder: () => Promise<Folder | undefined>;
  /**
   * Make the folder if it is new and open the board on it; the window moves on by itself. Resolves
   * why it couldn't, or undefined.
   */
  createWorkspace: (folder: string) => Promise<string | undefined>;
}

/** What the Dev Panel has an agent be, or `real` to check this Mac for it. */
export type AgentFake = "real" | AgentSetup["state"];

/** What the Dev Panel has the onboarding steps find, until the app quits. */
export interface DevFakes {
  agents: Record<AgentName, AgentFake>;
  /** A faked agent's fix fails, to see what the step offers then. */
  fixesFail: boolean;
  access: "real" | "granted" | "denied";
  /** Suggest a new folder for the workspace each time, so a run never opens a real one. */
  freshFolder: boolean;
}

/** Where the dev build keeps things, and what it is faking. */
export interface DevState {
  fakes: DevFakes;
  settingsFile: string;
  /** The real settings are set aside while the app runs as a new user. */
  setAside: boolean;
  workspace: string | undefined;
  defaultFolder: string;
  /** The bundle id macOS keeps this build's Full Disk Access under. */
  bundleId: string;
}

/** The dev build's own tools, for trying the first launch as a new user. Never in the released app. */
export interface CutfacDevTools {
  state: () => Promise<DevState>;
  setFakes: (fakes: DevFakes) => Promise<DevState>;
  /** What `state` resolves changed in the app, such as a faked fix that left its agent ready. */
  onStateChange: (listener: () => void) => () => void;
  /** Set the settings and the board's storage aside, and open the first launch from the start. */
  startOver: () => Promise<void>;
  /** Bring back the settings set aside, and the workspace they name. */
  restore: () => Promise<void>;
  /** Open the first launch on `step`, keeping the settings. */
  openStep: (step: OnboardingStep) => Promise<void>;
  /** Show a file or folder in Finder. */
  reveal: (path: string) => Promise<void>;
}

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
  /** The first launch, before there is a workspace. */
  onboarding: CutfacOnboarding;
  /** Only in the dev build's Dev Panel window. */
  dev?: CutfacDevTools;
  /** Open the Dev Panel, or bring it to the front. Only in the dev build's board window. */
  openDevPanel?: () => void;
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
