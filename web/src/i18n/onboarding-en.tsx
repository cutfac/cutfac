import type { AgentSetup } from "../desktop.ts";

type FixState = Exclude<AgentSetup["state"], "ready">;

/** The first launch's copy, kept apart from the board's so neither file grows past reading. */
export const onboardingEn = {
  step: (current: number, total: number) => `Step ${current} of ${total}`,
  /** A `cutfac://new` link opened the app; its request opens on the board once setup is done. */
  linkWaiting: "A video request from a link is waiting. It opens once setup is done.",
  back: "Back",
  welcome: {
    title: "Welcome to Cutfac",
    /** One line each, broken where the sentences end rather than wherever the width runs out. */
    body: [
      "Make short videos by asking your agent.",
      "Point at any moment to change it, and try a few versions side by side.",
    ],
    start: "Get started",
  },
  agent: {
    title: "Get your agent ready",
    body: "Cutfac makes videos through Claude Code or Codex on this Mac. One is enough.",
    checking: "Looking for agents on this Mac…",
    checkingOne: "Checking…",
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
    subscription:
      "Each needs its own subscription. Getting the one you already pay for ready is enough.",
    pick: "Both are ready. Pick the one to make your videos with, the one you pay for.",
    picked: "Using this one",
    next: "Next",
  },
  access: {
    title: "Let your agent see and use your screen",
    body: "Your agent records your apps for your videos, and uses them when you ask. It works under Cutfac's permissions, so turn these on for Cutfac.",
    turnOn: "Turn on",
    on: "On",
    link: "Turn on screen recording and app use",
    settingsTitle: "Mac permissions",
    skip: "Skip for now",
    next: "Next",
    /**
     * Each permission: its name, what it lets the agent do, what to do while its list is open, and
     * the list's title in System Settings, for the picture.
     */
    screen: {
      name: "Screen Recording",
      why: "Record your screen and apps to use in videos.",
      waiting: "Turn on Cutfac in the list. When macOS offers to reopen it, go ahead.",
      list: "Screen & System Audio Recording",
    },
    accessibility: {
      name: "Accessibility",
      why: "Let your agent click and type in other apps.",
      waiting: "Turn on Cutfac in the list…",
      list: "Accessibility",
    },
    /** What macOS 27 and later call accessibility, which they widened. */
    deviceControl: "Device Control and Data Access",
    /** The picture of System Settings with the panel under it. */
    preview: {
      pane: "Privacy & Security",
      search: "Search",
    },
  },
  ready: {
    title: "Ready to make your first video",
    body: "Your agent reads what you told it before every video. Cutfac keeps your videos and templates as plain files in one folder.",
    savedIn: "Saved in",
    failed: "Could not make the workspace. Try again.",
    defaultName: "My videos",
    start: "Start making",
    creating: "Setting up…",
  },
  dragHelper: {
    /** Under the app's name on the card, saying where it goes. */
    hint: "Drag into the list above",
  },
};

export type OnboardingMessages = typeof onboardingEn;
