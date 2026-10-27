import type { AgentSetup } from "../desktop.ts";

type FixState = Exclude<AgentSetup["state"], "ready">;

/** The first launch's copy, kept apart from the board's so neither file grows past reading. */
export const onboardingEn = {
  step: (current: number, total: number) => `Step ${current} of ${total}`,
  /** A `cutfac://new` link opened the app; its request opens on the board once setup is done. */
  linkWaiting: "A video request from a link is waiting. It opens once setup is done.",
  welcome: {
    title: "Welcome to Cutfac",
    body: "Make short videos by asking your agent. Point at any moment to change it, and try a few versions side by side.",
    start: "Get started",
  },
  agent: {
    title: "Get your agent ready",
    body: "Cutfac makes videos through Claude Code or Codex on this Mac. One is enough.",
    checking: "Looking for agents on this Mac…",
    checkFailed: "Could not look for agents",
    tryAgain: "Try again",
    state: {
      missing: "Not on this Mac yet",
      outdated: (version: string | undefined) =>
        version === undefined ? "Needs an update" : `Version ${version} needs an update`,
      signedOut: "Installed. Sign in to use it.",
      ready: "Ready",
    },
    fix: {
      missing: "Install",
      outdated: "Update",
      signedOut: "Sign in",
    } satisfies Record<FixState, string>,
    fixing: {
      missing: "Installing…",
      outdated: "Updating…",
      signedOut: "Finish signing in in your browser…",
    } satisfies Record<FixState, string>,
    failed: "That didn't finish. You can run it in Terminal instead:",
    copied: "Copied. Paste it into Terminal, then come back.",
    checkAgain: "Check again",
    subscription: "Each needs its own subscription. Pick the one you already pay for.",
    next: "Next",
  },
  access: {
    title: "Let your agent see your files",
    body: "Your agent reads the files you point it at, like a video in Downloads. Without Full Disk Access, macOS stops it with a prompt for each folder.",
    open: "Open System Settings",
    howTo: [
      "System Settings opens on Full Disk Access.",
      "Drag Cutfac from the small window into the list.",
    ],
    waiting: "Waiting for Cutfac in the list…",
    granted: "Access granted",
    skip: "Skip for now",
    skipNote: "macOS will ask for each folder instead.",
    /** The picture of System Settings with the panel under it. */
    preview: {
      list: "Full Disk Access",
      drop: "Drag into the list above",
      pane: "Privacy & Security",
      search: "Search",
    },
  },
  folder: {
    title: "Pick a home for your videos",
    body: "Cutfac keeps your templates and videos as plain files in one folder. You can open another one later.",
    change: "Change…",
    create: "Create",
    use: "Use this folder",
    creating: "Setting up…",
  },
  dragHelper: {
    /** Under the app's name on the card, saying where it goes. */
    hint: "Drag into the list above",
  },
};

export type OnboardingMessages = typeof onboardingEn;
