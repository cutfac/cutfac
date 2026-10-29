import type { ReactNode } from "react";

import type { ToolCount, ToolKind } from "../lib/run.ts";

const TOOL_PHRASES: Record<ToolKind, (count: number) => string> = {
  read: (count) => (count === 1 ? "read 1 file" : `read ${count} files`),
  search: (count) => (count === 1 ? "searched once" : `searched ${count} times`),
  edit: (count) => (count === 1 ? "edited 1 file" : `edited ${count} files`),
  command: (count) => (count === 1 ? "ran 1 command" : `ran ${count} commands`),
  other: (count) => (count === 1 ? "used 1 tool" : `used ${count} tools`),
};

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export const chatEn = {
  chat: {
    /** Names a run that has not said which agent it is. */
    agent: "Agent",
    rolledBack: (media: string | undefined) =>
      media === undefined ? "Rolled the media back to before" : `Rolled ${media} back to before`,
    editTitle: "Point at it, then say it",
    editBody:
      "Drag across the timeline to select a part, or drag a box on the video. Then type what should change there and press Enter. An agent makes the edit and you compare before and after. Raise the number of versions below to see a few side by side and keep one.",
    newTitle: "Ask for a first cut",
    newBody: "Describe the video you want below and the agent will make a first cut.",
    showTarget: "Show this part on the video",
    newMedia: "New media",
    working: "Working on it…",
    compacting: "Compacting the conversation…",
    compacted: "Conversation compacted",
    compactedHint:
      "The conversation grew long, so the agent summarized the earlier part to keep going.",
    stop: "Stop",
    failed: "The agent failed.",
    stopped: "Stopped before it finished.",
    notSent: "Not sent to an agent yet. Run it here, or copy the prompt into Claude Code or Codex.",
    showSteps: (count: number) => (count === 1 ? "Show 1 step" : `Show ${count} steps`),
    /** Sums up tool calls in a row, as in "Read 3 files, ran 2 commands". */
    toolSummary: (counts: ReadonlyArray<ToolCount>) =>
      capitalized(counts.map(({ kind, count }) => TOOL_PHRASES[kind](count)).join(", ")),
    runWith: (agent: string) => `Run with ${agent}`,
    retryWith: (agent: string) => `Try again with ${agent}`,
    copyPrompt: "Copy prompt",
    connectAgent: "Connect an agent",
    edited: (media: string) => (
      <>
        <span className="font-medium">{media}</span> was edited. Does it look right?
      </>
    ),
    keep: "Keep",
    restore: "Restore before",
    askAgain: "Ask again",
    /** Under the agent's question while it waits; `choices` when it offered answers to pick. */
    answerHint: (choices: boolean): string =>
      choices
        ? "Waiting for your answer. Pick one, or write your own below."
        : "Waiting for your answer. Write it below.",
    kept: "Kept",
    rolledBackBadge: "Rolled back",
    /** Versions the agent saved of `media`; `wanted` is how many the request asked for. */
    versionsReady: (media: ReactNode, saved: number, wanted: number | undefined) =>
      wanted !== undefined && wanted > saved ? (
        <>
          {saved} of {wanted} versions of {media} are ready to compare.
        </>
      ) : (
        <>
          {saved === 1 ? "1 version" : `${saved} versions`} of {media} ready. Compare them and keep
          one.
        </>
      ),
    keepNone: "Keep none",
    keptNone: "Kept none",
    keptVersion: (label: string) => `Kept “${label}”`,
    discarded: "Threw the versions away. The media stays as it was.",
    /** A request lined up behind others on the item; `ahead` is how many run before it. */
    waiting: (agent: string, ahead: number) =>
      ahead === 0
        ? `Next for ${agent}`
        : `Waiting for ${agent} · ${ahead} ${ahead === 1 ? "request" : "requests"} ahead`,
    reword: "Edit",
    save: "Save",
    cancel: "Cancel",
    cancelRequest: "Cancel request",
    /** The line stopped because the run before it failed or was stopped. */
    paused: (count: number) =>
      count === 1
        ? "1 request is on hold because the run before it did not finish."
        : `${count} requests are on hold because the run before them did not finish.`,
    resume: "Continue",
    cancelAll: "Cancel all",
  },
  /** The small request box that opens beside a box drawn on the frame. */
  boxPrompt: {
    label: "Request for this box",
    hint: {
      chat: "Enter sends to chat · Esc closes",
      copy: "Enter copies the prompt · Esc closes",
    },
    send: "Send",
  },
  /** Numbered pins on the frame and the timeline for the requests still in play. */
  pins: {
    state: {
      working: "Working",
      waiting: "Waiting",
      halted: "Did not finish",
      review: "Ready to review",
    },
    title: (number: number, state: string) => `#${number} · ${state}`,
  },
  /** A run the agent turned down because it isn't signed in, or its sign-in stopped working. */
  signIn: {
    title: (agent: string) => `Sign in to ${agent} again`,
    body: "Its sign-in expired or was removed, so it can't work on this. Sign in, then try again.",
    action: "Sign in again",
    checking: "Checking the sign-in…",
    signingIn: "Finish signing in in your browser…",
    done: "Signed in. Try the request again.",
    terminal: "Run this in Terminal, then try the request again:",
    failed: "That didn't finish. You can run it in Terminal instead:",
    copied: "Copied. Paste it into Terminal.",
  },
};

export type ChatMessages = typeof chatEn;
