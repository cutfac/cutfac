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
    title: "Turn on notifications and screen recording",
    body: "Cutfac tells you when a render finishes or your agent waits for you. Screen recording lets your agent record your screen and apps to use in videos.",
    turnOn: "Turn on",
    on: "On",
    asked: "Asked",
    granted: "All set",
    skip: "Skip for now",
    notifications: {
      name: "Notifications",
      why: "Hear when a render finishes or your agent waits.",
      /** The notification Turn on puts up, which has macOS ask. */
      sample: { title: "Cutfac", body: "This is how Cutfac tells you something is ready." },
    },
    screen: {
      name: "Screen Recording",
      why: "Record your screen and apps to use in videos.",
      waiting: "Turn on Cutfac in the list. When macOS offers to reopen it, go ahead.",
      /** The list's title in System Settings, for the picture. */
      list: "Screen & System Audio Recording",
    },
    /** The picture of System Settings with the panel under it. */
    preview: {
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
