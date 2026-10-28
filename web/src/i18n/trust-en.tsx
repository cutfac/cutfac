import type { Link } from "./link.ts";

/** Trusting a workspace's own Claude Code settings before Claude runs there. */
export const trustEn = {
  title: "Look over this workspace's Claude Code settings",
  body: "Claude Code loads these settings from the folder on every run, and they run or allow commands without asking. Cutfac starts Claude here once you trust them. Codex leaves a folder's settings off until you trust it in Codex.",
  wholeFile: "The whole file",
  trust: "Trust and use them",
  trusting: "Trusting…",
  trusted: "Claude can run in this workspace now",
  failed: "Could not trust the workspace",
  error: "Could not read this workspace's Claude Code settings",
  /** By the message box while Claude waits for the trust. */
  note: (setup: Link) => (
    <>Claude starts once you {setup("look over this workspace's settings")} and trust them.</>
  ),
};

export type TrustMessages = typeof trustEn;
