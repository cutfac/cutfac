import type { ReactNode } from "react";

import type { LearnedKind } from "../api.ts";
import type { ImportState } from "../lib/imports.ts";
import type { TemplateState } from "../lib/templates.ts";
import type { Link } from "./link.ts";

export const libraryEn = {
  learn: {
    title: "Brief",
    description:
      "Your agent reads this page before every video, so the next one follows what you change.",
    sheet: {
      title: "What you make",
      purpose: "What you do",
      purposeHint: "Pick the one closest to you.",
      choose: "Choose",
      platforms: "Where videos go",
      aspect: "Vertical, 9:16",
      bodyLabel: "Notes for your agent",
      bodyPlaceholder: "Who it's for, how it should feel, what to never say.",
      saving: "Saving…",
      saved: "Saved",
    },
    materials: "What your agent read",
    materialsBody:
      "Links, folders and files about what you make. Your agent keeps what matters from each.",
    loadError: "Could not load what your agent has learned",
    input: "Link or path",
    placeholder: "Paste a link or a folder path, or drop a file",
    submit: "Add",
    choose: "Choose…",
    dropHere: "Drop to add it",
    reading: (source: string) => `Adding ${source}…`,
    learned: (title: string) => `Added "${title}"`,
    error: "Could not add that",
    warnings: "Added, with notes",
    emptyBody:
      "Start with your website or your app's store page. A project folder or a video you like works too.",
    unread: "Not read yet",
    unreadBody:
      "Your agent hasn't read this yet. It will before your next video, or now with Read now.",
    showMore: "Show more",
    showLess: "Show less",
    nothingKept: "Your agent kept nothing from this.",
    readNow: "Read now",
    readNowHint: (count: number) =>
      count === 1
        ? "Your agent reads the new source now."
        : `Your agent reads the ${count} new sources now.`,
    agentReading: "Your agent is reading…",
    readingOne: "Reading",
    readingBody: "Your agent is reading this now. What it keeps shows here.",
    readFailed: "Could not start your agent",
    noAgent: "Connect an agent in Setup to read these.",
    kinds: {
      page: "Web page",
      app: "App",
      video: "Video",
      folder: "Folder",
      file: "File",
    } satisfies Record<LearnedKind, string>,
    uploaded: "Uploaded file",
    open: "Open link",
    forget: "Forget",
    forgetTitle: (title: string) => `Forget "${title}"?`,
    forgetBody: "Its saved files and what your agent wrote about it are removed.",
    forgotten: (title: string) => `Forgot "${title}"`,
    forgetError: "Could not forget it",
    notesTitle: "Other notes",
    notesBody: "What you or your agent wrote in about.md that isn't about one source.",
    fileNote: "All of it lives in about.md in your workspace.",
    showFile: "Show file",
  },
  templates: {
    title: "Templates",
    description:
      "The recipes your agent makes videos from. Bring one in from any link, or have your agent distill one from a video it learned.",
    loadError: "Could not load the templates",
    add: "Add from link",
    addTitle: "Add a template from a link",
    addBody:
      "Paste a link to a template, a skill, or a post. Your agent reads it here and tells you what it needs. Nothing is installed until you press Allow.",
    link: "Link",
    linkPlaceholder: "Paste a link",
    files: "Files",
    filesHint:
      "Optional. You can also drop or paste them here; your agent gets them with the link.",
    copyPrompt: "Copy prompt",
    promptCopied: "Prompt copied. Paste it into your agent.",
    copyFix: "Copy fix prompt",
    emptyTitle: "No templates yet",
    emptyBody: (link: Link) => (
      <>
        Add one from a link, or {link("learn a video you like")} and ask your agent to save a
        template from it.
      </>
    ),
    missingTitle: "Template not found",
    missingBody: "It may have been renamed or removed.",
    state: {
      ready: "Ready",
      incomplete: "Needs setup",
      broken: "Cannot be read",
    } satisfies Record<TemplateState, string>,
    incompleteTitle: "This template needs a few things before it can be used",
    brokenTitle: "This template's format.yaml cannot be read",
    fixHint: "Copy the fix prompt and give it to your agent.",
    duration: (min: number, max: number) => `${min}–${max}s`,
    needsAudio: "Needs audio",
    skills: "Skills",
    installed: "Installed",
    missing: "Not installed",
    programs: "Programs",
    source: "Source",
    author: "Author",
    license: "License",
    inputs: "Inputs",
    inputsBody: "Picked or written when a new video is made from this template.",
    required: "Required",
    freeText: "Free text",
    default: "Default",
    defaultValue: (value: string) => `Default: ${value}`,
    structure: "Structure",
    hookRules: "Hook rules",
    checklist: "Checklist",
  },
  imports: {
    listTitle: "Importing",
    agent: "Agent",
    start: "Bring it in",
    noAgent: (link: Link) => (
      <>No agent is installed. {link("Connect one")}, or copy the prompt into your own agent.</>
    ),
    state: {
      reading: "Reading the link…",
      waiting: "Waiting for you",
      installing: "Setting it up…",
      done: "Done",
      failed: "Failed",
      stopped: "Stopped",
      closed: "Closed",
    } satisfies Record<ImportState, string>,
    startMessage: (link: ReactNode) => <>Bring in a template from {link}</>,
    fromBrief: "From your brief",
    briefMessage: (link: ReactNode | undefined) =>
      link === undefined ? (
        <>Make a template from my brief</>
      ) : (
        <>Make a template from my brief, modeled on {link}</>
      ),
    allowed: "Allowed installs",
    allowTitle: "Let the agent set it up?",
    allowBody:
      "The agent can then install what it listed above and write the template into this workspace. Allow it only if you trust where the link comes from.",
    allow: "Allow",
    askFirst: "Not sure? Ask about it below first.",
    retry: "Try again",
    /** Sent to the agent as the user's reply when they try again. */
    retryBody: "Please pick up where you left off.",
    added: "Added",
    addedNothing: "Nothing was added yet",
    addedNothingBody: "Ask the agent below what is left, or finish if you are done.",
    finish: "Finish",
    close: "Close import",
    closedNote: "This import is closed.",
    placeholder: {
      waiting: "Ask a question, or press Allow",
      working: "The agent is working…",
      reply: "Reply to the agent",
    },
    reply: "Reply",
    loadError: "Could not load the import",
  },
};

export type LibraryMessages = typeof libraryEn;
