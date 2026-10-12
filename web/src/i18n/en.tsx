import type { ReactNode } from "react";

import type { AgentChoice, Status } from "../api.ts";

/** Wraps a phrase in a link, so a translation can put the link wherever its grammar needs it. */
type Link = (text: string) => ReactNode;

const SCHEDULE_STATUS = new Map([
  ["planned", "Planned"],
  ["scheduled", "Scheduled"],
  ["published", "Published"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
]);

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
    calendar: "Calendar",
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
  /** Schedule entries are free-form in the workspace, so an unknown status shows as written. */
  scheduleStatus: (status: string) => SCHEDULE_STATUS.get(status) ?? status,
  board: {
    title: "Board",
    loadError: "Could not load the board",
    count: (count: number) => (count === 1 ? "1 item" : `${count} items`),
    allFormats: "All formats",
    filterByFormat: "Filter by format",
    archived: "Archived",
    emptyTitle: "Create your first video — the agent will make it",
    emptyBody: "Give it a title and pick a format. You review the result here and ask for changes.",
    emptyColumn: "Nothing here",
    openFeedback: (count: number) => `${count} open`,
    legacy: "legacy",
    legacyHint: "Folder without item.yaml; status derived from STATUS.md",
  },
  calendar: {
    title: "Calendar",
    loadError: "Could not load the calendar",
    empty: "Nothing scheduled yet. When your agent schedules a post, it shows up here.",
    previous: "Previous month",
    next: "Next month",
    today: "Today",
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
    formats: "Formats",
    formatsBody: "The reusable recipes your agent makes videos from.",
    formatsEmpty: (link: Link) => (
      <>No formats yet. {link("Analyze a reference")} and ask your agent to save one.</>
    ),
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
    format: "Format",
    noFormat: "No format",
    optional: "Optional",
    formatHint: "A format gives the agent a proven structure to follow.",
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
    timezone: "Timezone",
    platforms: "Platforms",
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
    editing: (agent: string) => `${agent} is editing`,
    status: "Status",
    noMediaTitle: "No video yet",
    noMediaBody:
      "Drop a video or an image here to start from, or ask in the chat and an agent will make a first cut.",
    addMedia: "Add a video or image",
    add: "Add",
    checksBody: "Check the videos against what the platforms accept.",
    runChecks: "Run checks",
    runAgain: "Run again",
    noVideos: "No videos to check.",
    format: "Format",
    reference: "Reference",
    title: "Title",
    hook: "Hook",
    caption: "Caption",
    notes: "Notes",
    hookPlaceholder: "The line that makes people stay",
    captionPlaceholder: "What goes under the post",
    notesPlaceholder: "Anything worth remembering about this video",
    titleRequired: "The title cannot be empty.",
    firstComment: (comment: string) => `First comment: ${comment}`,
    schedule: "Schedule",
    open: "Open",
    metrics: "Metrics",
    platform: "Platform",
    date: "Date",
    views: "Views",
    likes: "Likes",
    shares: "Shares",
    saves: "Saves",
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
