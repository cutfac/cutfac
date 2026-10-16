import type { ReactNode } from "react";

import type { AgentChoice, DetailField, Status } from "../api.ts";
import type { ImportState } from "../lib/imports.ts";
import type { TemplateState } from "../lib/templates.ts";

/** Wraps a phrase in a link, so a translation can put the link wherever its grammar needs it. */
type Link = (text: string) => ReactNode;

/**
 * Every piece of copy in the board. Other languages are typed as `Messages`, so a missing or
 * misnamed key fails the type check. Agent prompts stay in English and are not here.
 */
export const en = {
  common: {
    somethingWrong: "Something went wrong",
    cancel: "Cancel",
    close: "Close",
    copy: "Copy",
    couldNotCopy: (message: string) => `Could not copy: ${message}`,
  },
  app: {
    unreachable: "Cannot reach the factory server",
  },
  nav: {
    appName: "Content Factory",
    openWorkspace: "Open workspace…",
    newVideo: "New video",
    main: "Main",
    board: "Board",
    references: "References",
    templates: "Templates",
    product: "Product",
    setup: "Setup",
    sendFeedback: "Send feedback",
    videos: "Videos",
    allVideos: "All videos",
    toggle: "Toggle sidebar",
    openFeedback: (count: number) => `${count} open feedback`,
    videoTitle: (title: string, status: string, open: number) =>
      open > 0 ? `${title} (${status}, ${open} open feedback)` : `${title} (${status})`,
  },
  language: {
    label: "Language",
  },
  status: {
    idea: "Idea",
    drafting: "Drafting",
    review: "Review",
    approved: "Approved",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  } satisfies Record<Status, string>,
  board: {
    title: "Board",
    loadError: "Could not load the board",
    count: (count: number) => (count === 1 ? "1 item" : `${count} items`),
    allFormats: "All templates",
    filterByFormat: "Filter by template",
    archived: "Archived",
    emptyTitle: "Create your first video — the agent will make it",
    emptyBody:
      "Give it a title and pick a template. You review the result here and ask for changes.",
    emptyColumn: "Nothing here",
    openFeedback: (count: number) => `${count} open`,
    legacy: "legacy",
    legacyHint: "Folder without item.yaml; status derived from STATUS.md",
  },
  product: {
    title: "Product",
    loadError: "Could not load the product",
    about: "About",
    audience: "Audience",
    cta: "Default CTA",
    rules: "Rules",
    missingTitle: "No product details yet",
    missingBody: (file: ReactNode) => (
      <>Import them from a link below, or fill in {file}. Every agent run reads it.</>
    ),
    importTitle: "Import from a link",
    importBody:
      "Fills empty fields and refreshes store screenshots. Your edits to product.yaml are kept.",
    store: "Store listing",
    captures: "App captures",
    capturesEmpty: (folder: ReactNode) => (
      <>Add reviewed screenshots or screen recordings to {folder}. Agents use them in the videos.</>
    ),
  },
  templates: {
    title: "Templates",
    description:
      "The recipes your agent makes videos from. Bring one in from any link, or distill one from references.",
    loadError: "Could not load the templates",
    add: "Add from link",
    addTitle: "Add a template from a link",
    addBody:
      "Paste a link to a template, a skill, or a post. Your agent reads it here and tells you what it needs. Nothing is installed until you press Allow.",
    link: "Link",
    linkPlaceholder: "Paste a link",
    copyPrompt: "Copy prompt",
    promptCopied: "Prompt copied. Paste it into your agent.",
    copyFix: "Copy fix prompt",
    emptyTitle: "No templates yet",
    emptyBody: (link: Link) => (
      <>Add one from a link, or {link("analyze a reference")} and ask your agent to save one.</>
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
    tools: "Agent tools",
    source: "Source",
    author: "Author",
    license: "License",
    inputs: "Inputs",
    inputsBody: "Picked or written when a new item is made from this template.",
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
  newItem: {
    open: "New item",
    title: "New item",
    description:
      "Name the video and the agent takes it from there. Add a clip if you already have footage.",
    notMedia: "Choose a video or an image file.",
    uploadFailed: (message: string) => `Item created, but the upload failed: ${message}`,
    titleLabel: "Title",
    titlePlaceholder: "What is the video about?",
    format: "Template",
    noFormat: "No template",
    optional: "Optional",
    formatHint: "A template gives the agent a proven structure to follow.",
    required: "Required",
    choose: "Choose…",
    none: "None",
    file: "Video or image",
    removeFile: "Remove file",
    drop: "Drop a file here, or click to browse",
    createError: "Could not create the item",
    uploading: "Uploading…",
    creating: "Creating…",
    create: "Create item",
  },
  setup: {
    title: "Set up",
    description: "Two quick steps, then your agent can start making videos for your app.",
    done: "(done)",
    agents: {
      claude: "Claude Code",
      codex: "Codex",
      queue: "Copy-paste queue",
    } satisfies Record<AgentChoice, string>,
    connectTitle: "Connect your agent",
    connectBody:
      "Your agent does the production and editing. The factory gives it tools, files, and your feedback.",
    agentsError: "Could not check for installed agents",
    productTitle: "Tell it about your app",
    productBody:
      "Paste an App Store, Google Play, or website link. Store links on your site are followed.",
    review: "Review",
    readyTitle: "You're set",
    readyBody: (board: Link) => (
      <>
        Ask your agent to find a reference and make the first video, then review it on the{" "}
        {board("board")}.
      </>
    ),
    workspaceTitle: "Your workspace",
    workspaceBody:
      "Everything the factory makes is a plain file in this folder. You can back it up or put it in git.",
    name: "Name",
    folder: "Folder",
    defaultAgent: "Default agent",
    showFolder: "Show folder",
    connected: (agent: string) => `${agent} is connected`,
    connectFailed: (agent: string) => `Could not connect ${agent}`,
    agentReady: "Ready. It can use the factory's tools.",
    agentFound: "Found on this computer. Connect it so it can use the factory's tools.",
    agentMissing: "Not installed on this computer.",
    connectedBadge: "Connected",
    connecting: "Connecting…",
    connect: "Connect",
    notInstalled: "Not installed",
  },
  importForm: {
    imported: "Imported your app's details",
    link: "App link",
    placeholder: "https://apps.apple.com/… or https://yourapp.com",
    reading: "Reading…",
    submit: "Import",
    error: "Could not import that link",
    warnings: "Imported, with notes",
  },
  references: {
    title: "References",
    description: (count: number | undefined) =>
      count === undefined
        ? "Short videos you like. Your agent studies these to learn what works."
        : `${count} saved. Your agent studies these to learn what works.`,
    loadError: "Could not load references",
    added: (title: string) => `Added "${title}"`,
    notVideo: "Choose a video file.",
    processing: (file: string) => `Processing ${file}…`,
    downloading: "Downloading and processing…",
    link: "Reference link",
    linkPlaceholder: "Paste a TikTok, Reels, or Shorts link",
    add: "Add",
    drop: "Or drop a video file here, or click to browse",
    addError: "Could not add that reference",
    emptyTitle: "No references yet",
    emptyBody:
      "Add a video you wish you had made. Your agent will take it apart and work out why it holds attention.",
    missingTitle: "Reference not found",
    missingBody: "It may have been removed. Choose another one from the list.",
    pickTitle: "Pick a reference",
    pickBody: "Choose one from the list to watch it and read the analysis.",
    analyzed: "Analyzed",
    notAnalyzed: "Not analyzed yet",
    promptCopied: "Prompt copied. Paste it to your agent.",
    copyReanalysis: "Copy re-analysis prompt",
    copyAnalysis: "Copy analysis prompt",
    contactSheet: "Contact sheet of frames from the video",
    withAudio: "With audio",
    noAudio: "No audio",
    cuts: (count: number) => (count === 1 ? "1 cut" : `${count} cuts`),
    frames: (count: number) => (count === 1 ? "1 frame" : `${count} frames`),
    notAnalyzedBody:
      "Copy the analysis prompt and give it to your agent. It will watch the video and write up how it works.",
  },
  item: {
    openError: "Cannot open this item",
    imageHint: "Drag on the image to mark the area an edit is about.",
    chat: "Chat",
    checks: "Checks",
    details: "Details",
    history: "History",
    editing: (agent: string) => `${agent} is editing`,
    status: "Status",
    noMediaTitle: "No video yet",
    noMediaBody:
      "Drop a video or an image here to start from, or ask in the chat and an agent will make a first cut.",
    addMedia: "Add a video or image",
    add: "Add",
    format: "Template",
    reference: "Reference",
    title: "Title",
    hook: "Hook",
    notes: "Notes",
    hookPlaceholder: "The line that makes people stay",
    notesPlaceholder: "Anything worth remembering about this video",
    titleRequired: "The title cannot be empty.",
  },
  checks: {
    template: "Template",
    templateMissing: (id: string) => `There is no "${id}" template in this workspace.`,
    checklist: "The agent holds every render to this checklist:",
    frames: "Frame review",
    framesBody:
      "What the agent looked at when it last checked each video: frames from start to end, and the motion across each cut.",
    noReview: (file: string) => `${file} has not been reviewed yet.`,
    noReviewHint: "Agents review a video before handing it off. Ask in the chat to review it now.",
    reviewed: (ago: string) => `Reviewed ${ago}`,
    stale: "The video changed after this review.",
    sheet: (file: string) => `Frames of ${file}`,
    strip: (time: string) => `Motion around ${time}`,
    rules: "Upload rules",
    rulesBody: "Check the videos against what the platforms accept.",
    run: "Run checks",
    runAgain: "Run again",
    noVideos: "No videos to check.",
  },
  history: {
    undo: "Undo",
    redo: "Redo",
    undone: (change: string) => `Undone: ${change}`,
    redone: (change: string) => `Redone: ${change}`,
    backTo: (change: string) => `Back to right after: ${change}`,
    backToOriginal: "Back to the original",
    restoredVersion: (media: string) => `Restored an earlier ${media}`,
    running: "An agent is working on this item. Wait for it or stop it before going back.",
    emptyTitle: "No changes yet",
    emptyBody:
      "Edits, rollbacks, and changes to the details land here, and you can step back to any of them.",
    changes: "Changes",
    changesHint:
      "Click a change to go back to right after it. Undone changes stay until you make a new one.",
    original: "Original",
    originalHint: "Before the first change recorded here",
    now: "Now",
    undoneHint: "Undone. Click to redo up to here.",
    versions: "Saved versions",
    versionsHint: "Every version each file has had. Restoring one is a change you can undo, too.",
    restore: "Restore",
    inUse: "In use",
    edit: (request: string) => `Edit “${request}”`,
    editMedia: (media: string) => `Edit to ${media}`,
    rollback: (media: string) => `Rolled back ${media}`,
    version: (media: string) => `Restored an earlier ${media}`,
    outside: (media: string) => `Changed ${media} outside a request`,
    renamed: (title: string) => `Renamed to “${title}”`,
    moved: (status: string) => `Moved to ${status}`,
    changed: (fields: string) => `Changed the ${fields}`,
    fields: {
      title: "title",
      status: "status",
      hook: "hook",
      notes: "notes",
    } satisfies Record<DetailField, string>,
  },
  shortcuts: {
    open: "Keyboard shortcuts",
    title: "Keyboard shortcuts",
    description: "Single keys work whenever you are not typing in a field.",
    playback: "Playback",
    playPause: "Play or pause",
    step: "Step a tenth of a second",
    stepLong: "Step a second",
    selection: "Selection",
    markIn: "Start the selection at the playhead",
    markOut: "End the selection at the playhead",
    loop: "Loop the selection",
    clear: "Clear the selection",
    changes: "Changes",
    undo: "Undo the last change",
    redo: "Redo",
    request: "Request",
    send: "Send the request",
    newLine: "New line",
    help: "Show these shortcuts",
  },
  chat: {
    /** Names a run that has not said which agent it is. */
    agent: "Agent",
    rolledBack: (media: string | undefined) =>
      media === undefined ? "Rolled the media back to before" : `Rolled ${media} back to before`,
    editTitle: "Point at it, then say it",
    editBody:
      "Drag across the timeline to select a part, or drag a box on the video. Then type what should change there and press Enter. An agent makes the edit and you compare before and after.",
    newTitle: "Ask for a first cut",
    newBody:
      "Describe the video you want below and an agent will make it, or add a video or an image to start from.",
    showTarget: "Show this part on the video",
    newMedia: "New media",
    working: "Working on it…",
    stop: "Stop",
    failed: "The agent failed.",
    stopped: "Stopped before it finished.",
    notSent: "Not sent to an agent yet. Run it here, or copy the prompt into Claude Code or Codex.",
    showSteps: (count: number) => (count === 1 ? "Show 1 step" : `Show ${count} steps`),
    runWith: (agent: string) => `Run with ${agent}`,
    retryWith: (agent: string) => `Try again with ${agent}`,
    copyPrompt: "Copy prompt",
    connectAgent: "Connect an agent",
    edited: (media: ReactNode) => <>{media} was edited. Does it look right?</>,
    keep: "Keep",
    restore: "Restore before",
    askAgain: "Ask again",
    kept: "Kept",
    rolledBackBadge: "Rolled back",
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
    /** `agent` is the agent's name, or undefined when the request is copied as a prompt. */
    hint: (agent: string | undefined) =>
      agent === undefined
        ? "Enter copies the prompt · Esc closes"
        : `Enter sends to ${agent} · Esc closes`,
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
  composer: {
    /** The agent choice that sends nothing and copies the prompt instead. */
    queue: "Copy prompt",
    /** Starting points for the common edits, so the first request is one click and a tweak away. */
    ideas: {
      range: ["Cut this part", "Speed this part up", "Add a caption here", "Make this brighter"],
      box: ["Zoom in on the box", "Blur this area", "Point an arrow here"],
      whole: [
        "Tighten the pacing",
        "Add captions for the speech",
        "Make the first second grab attention",
      ],
      new: [
        "Make a 15-second vertical video from the product captures",
        "Make a short teaser from the reference",
      ],
    },
    placeholder: {
      range: "What should change in this part?",
      box: "What should change in the box?",
      whole: "What should change? Select a part first to be precise.",
      new: "Describe the video you want…",
    },
    promptCopied: "Prompt copied. Paste it into Claude Code or Codex in this workspace.",
    promptReady: "The prompt is ready to copy",
    wholeVideo: "Whole video",
    clear: "Clear the selection",
    request: "Edit request",
    agent: "Agent to send to",
    /** The model and reasoning effort the agent runs with; a default is the agent's own pick. */
    models: {
      label: "Model and reasoning effort",
      model: "Model",
      effort: "Reasoning effort",
      defaultModel: "Default model",
      /** `pick` is what the agent picks by default, when it says. */
      byDefault: (pick: string | undefined) =>
        pick === undefined ? "Default" : `Default (${pick})`,
      /** Efforts the agents take; one not listed shows as the agent names it. */
      efforts: {
        none: "None",
        minimal: "Minimal",
        low: "Low",
        medium: "Medium",
        high: "High",
        xhigh: "Extra high",
        max: "Max",
      },
    },
    /** Folders, files, and web pages agents read whenever they work on the item. */
    sources: {
      add: "Add a folder, file, or link for agents to read",
      list: "What agents read",
      title: "Sources",
      description: "Agents read these whenever they work on this video.",
      placeholder: "Paste a link or a folder path",
      submit: "Add",
      choose: "Choose a folder or file…",
      /** The workspace folder itself, which has no name of its own to show. */
      workspace: "This workspace",
      remove: (name: string) => `Remove ${name}`,
    },
    stop: "Stop the agent",
    send: "Send (Enter)",
  },
  compare: {
    open: "Compare",
    title: "Before and after",
    before: "Before",
    after: "After",
    image: (media: string | undefined, side: string) => `${media ?? "Media"}, ${side}`,
    playBoth: (time: string) => `Play both from ${time}`,
    restore: "Restore before",
    keep: "Keep the edit",
  },
  transport: {
    play: "Play",
    pause: "Pause",
    in: "In",
    inHint: "Start the selection at the playhead",
    out: "Out",
    outHint: "End the selection at the playhead",
    loop: "Loop the selection",
    loopHint: "Play the selection over and over",
    hint: "Drag on the timeline to select a part · drag on the video to mark an area",
    clear: "Clear the selection",
  },
  target: {
    /** Follows a range in a selection's summary: `0:01.0–0:02.0 · box at 0:04.0`. */
    boxAt: (time: string) => `box at ${time}`,
    box: (time: string) => `Box · ${time}`,
    boxMarker: (time: string) => `Box at ${time}`,
    goToBox: "Go to the frame this box is on",
    removeBox: "Remove the box",
  },
};

export type Messages = typeof en;
