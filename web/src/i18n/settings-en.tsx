import type { ReactNode } from "react";

import type { AgentChoice } from "../api.ts";
import type { Link } from "./link.ts";

export const settingsEn = {
  setup: {
    title: "Settings",
    description: "Which agents make your videos, what they may do, and where the files live.",
    agents: {
      claude: "Claude Code",
      codex: "Codex",
      queue: "Copy-paste queue",
    } satisfies Record<AgentChoice, string>,
    connectTitle: "Your agents",
    connectBody:
      "Work you start from the board runs your agent with Cutfac's tools, connected or not. Connect it to use Cutfac from your agent's own chat too.",
    agentsError: "Could not check for installed agents",
    workspaceTitle: "Your workspace",
    workspaceBody:
      "Everything Cutfac makes is a plain file in this folder. You can back it up or put it in git.",
    name: "Name",
    folder: "Folder",
    defaultAgent: "Default agent",
    showFolder: "Show folder",
    connectFailed: (agent: string) => `Could not connect ${agent}`,
    agentReady: "Connected. Its own chat can use Cutfac's tools too.",
    agentFound: "Found on this computer. Connect it to use Cutfac from its own chat too.",
    agentMissing: "Not installed on this computer.",
    connectedBadge: "Connected",
    connecting: "Connecting…",
    connect: "Connect",
    notInstalled: "Not installed",
    agentOutdated: (agent: string, version: string, minimum: string, command: ReactNode) => (
      <>
        {agent} {version} is older than {minimum}, the oldest version Cutfac supports, so some
        things may not work. Update it by running {command} in a terminal.
      </>
    ),
  },
  license: {
    title: "License key",
    description: (portal: Link) => (
      <>
        A license key unlocks the paid plan, so you can make as many videos as you want. Find it in
        the email Polar sent when you checked out, or in the {portal("customer portal")}.
      </>
    ),
    label: "License key",
    placeholder: "Paste your license key",
    replace: "A key is saved already. A new one replaces it.",
    invalid: "That key isn't valid. Copy it again from your purchase email or the customer portal.",
    checking: "Checking…",
    save: "Save",
    granted: "License key saved.",
    ended: "License key saved, but its plan has ended, so you're on the free version.",
    full: "License key saved, but it's already on as many Macs as it allows. On a Mac you no longer use, choose Cutfac › Deactivate This Mac; this Mac unlocks the next time you come back to it.",
    unavailable: "License key saved. Couldn't reach cutfac.com to confirm it yet.",
  },
  /**
   * Which Cutfac this is: the desktop app's free version, which makes a few videos with every
   * feature open, or the open-source version.
   */
  plan: {
    freeTitle: "Free version",
    used: (used: number, limit: number) => `${used} of ${limit} videos used`,
    upgrade: "Upgrade",
    enterKey: "Enter license key",
    openSource: "Open-source version",
    getDesktop: "Get the desktop app",
    limitReached:
      "You've used all of the free version's videos. Upgrade to make new ones or to work on a video made outside Cutfac. The videos Cutfac made stay editable.",
  },
};

export type SettingsMessages = typeof settingsEn;
