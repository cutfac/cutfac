import type { AgentName } from "./api.ts";
import type { Locale } from "./i18n/locale.ts";
import type { BriefDraft } from "./lib/brief.ts";

export type EditCommand = "undo" | "redo";

/** What the app menu asks of the board, beyond Undo and Redo: a dialog, the sidebar, or a page. */
export type AppCommand = "palette" | "newVideo" | "toggleSidebar" | "board" | "learn" | "templates";

/** A new video a `cutfac://new` link on a web page asks for, for the user to look over and send. */
export interface NewVideoLink {
  prompt: string;
  /** What the page that linked here calls itself, a short lowercase name. */
  source?: string;
}

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

/**
 * What the app asks macOS for on a list in System Settings: recording the screen for footage, and
 * using other apps (accessibility). The agents it runs act under them too.
 */
export type Permission = "screen" | "accessibility";

/**
 * What the first launch asked about the user before there was a workspace to save it in: the
 * brief and the material to read, or that they left it for later. The app keeps it until the
 * workspace is made, so it lasts through the relaunch screen recording asks for.
 */
export interface OnboardingDraft {
  brief: BriefDraft;
  sources: string[];
  /** What to share with the Cutfac team, each once answered. */
  sharing?: Partial<Record<SharingPurpose, boolean>>;
}

/** What can be shared with the Cutfac team, each asked on its own. */
export type SharingPurpose = "errorReports" | "usageStats";

/** Whether this build can share, and the person's answer for each purpose: null until given. */
export interface Sharing extends Record<SharingPurpose, boolean | null> {
  available: boolean;
}

/** The first-launch steps that come before there is a workspace. */
export type OnboardingStep = "welcome" | "make" | "agent" | "access" | "folder";

/** A folder as the workspace step shows it: its path, and the same shortened from the home folder. */
export interface Folder {
  path: string;
  label: string;
}

/** Why a workspace couldn't be made: its name is taken or can't be a folder's, or what failed. */
export type CreateFailure =
  | { kind: "taken" }
  | { kind: "invalid" }
  | { kind: "failed"; message: string };

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
  /** What the first launch asked about the user, kept since; undefined before it was asked. */
  draft: () => Promise<OnboardingDraft | undefined>;
  /** Keep what the first launch asked so far. */
  saveDraft: (draft: OnboardingDraft) => Promise<void>;
  /** Forget it, once the workspace has it. */
  clearDraft: () => Promise<void>;
  /**
   * Whether this build can share error reports and usage statistics with the Cutfac team, and what
   * the person answered for each before: null until they did.
   */
  sharing: () => Promise<Sharing>;
  /** macOS's major version, such as 27; the lists in System Settings are named by it. */
  systemVersion: () => Promise<number>;
  /** Whether macOS grants the app a permission. Screen recording shows only after the app reopens. */
  permission: (permission: Permission) => Promise<boolean>;
  /**
   * Open a permission's list in System Settings, with a small window beside it to drag the app
   * from. The app comes back to the front once the permission is granted.
   */
  openAccessSettings: (permission: Permission) => Promise<void>;
  /** A permission was granted while System Settings was open. Returns an unsubscribe. */
  onAccessGranted: (listener: (permission: Permission) => void) => () => void;
  /**
   * Put up a sample notification. The first one has macOS ask whether the app may notify, which
   * Electron has no other way to ask.
   */
  askNotifications: (sample: { title: string; body: string }) => Promise<void>;
  /** Drag the app itself into a list in System Settings, from the helper window. */
  startAppDrag: () => void;
  /** Makes the helper window the one that shows the cursor, as the pointer reaches it. */
  focusDragHelper: () => void;
  /** The app as a list in System Settings shows it, for the helper window to show as the thing to drag. */
  appIcon: () => Promise<{ icon: string; name: string }>;
  /**
   * Make the first workspace from the answers so far, named `name` unless the build names it, with
   * `agent` as its agent when it is ready, and start the agent reading the material while the user
   * goes on. Resolves at once.
   */
  startWorkspace: (name: string, agent?: AgentName) => Promise<void>;
  /**
   * Where the first workspace was made, or, before it is, as after a relaunch, where it will be
   * made under `name`; undefined if neither is known.
   */
  workspaceFolder: (name: string) => Promise<Folder | undefined>;
  /**
   * Open the board on the first workspace, making it now if it wasn't, as after a relaunch; the
   * window moves on by itself. Resolves why it couldn't, or undefined.
   */
  createWorkspace: (name: string, agent?: AgentName) => Promise<CreateFailure | undefined>;
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
  /** The bundle id macOS keeps this build's permissions under. */
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

/** What waits for the user on the board, as the app's Dock badge and notifications tell it. */
export interface Attention {
  /** How many videos wait for the user. */
  waiting: number;
  /** How many videos have an agent or a render at work, which quitting the app would stop. */
  busy: number;
  /** The videos whose agent waits for the user's OK on a tool, or their answer to a question. */
  asking: { id: string; title: string; about: "approval" | "question" }[];
}

/** The workspaces in the app's folder, by name, and which one is open. */
export interface LibraryWorkspaces {
  workspaces: { name: string; path: string; current: boolean }[];
}

/** What the Electron preload script exposes; absent when the board runs in a plain browser. */
export interface CutfacDesktop {
  /** Ask for a workspace folder and restart the local server on it. Resolves false if cancelled. */
  openWorkspace: () => Promise<boolean>;
  /** The workspaces in the app's folder. */
  workspaces: () => Promise<LibraryWorkspaces>;
  /** Open the workspace of that name in the app's folder. Resolves false if it didn't. */
  switchWorkspace: (name: string) => Promise<boolean>;
  /** Make a workspace of that name in the app's folder and open it. Resolves why it couldn't. */
  newWorkspace: (name: string) => Promise<CreateFailure | undefined>;
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
  /**
   * Tell the app what waits for the user, for its Dock badge, and a notification when an agent
   * starts asking while the app is in the background.
   */
  setAttention: (attention: Attention) => void;
  /** Undo and Redo chosen from the app menu or its shortcuts. Returns an unsubscribe. */
  onEditCommand: (listener: (command: EditCommand) => void) => () => void;
  /** A command chosen from the app menu or its shortcuts. Returns an unsubscribe. */
  onAppCommand: (listener: (command: AppCommand) => void) => () => void;
  /**
   * The new video a `cutfac://new` link on a web page opened the app with, for the user to send
   * themselves. Takes it: one that came before this was called arrives at once. Returns an
   * unsubscribe.
   */
  onNewVideoLink: (listener: (link: NewVideoLink) => void) => () => void;
  /**
   * Whether a link's new video waits for the board to take it, now and whenever a link comes,
   * without taking it. Returns an unsubscribe.
   */
  onNewVideoLinkWaiting: (listener: (waiting: boolean) => void) => () => void;
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
