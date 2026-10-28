import type { Status } from "../api.ts";

export const boardEn = {
  status: {
    drafting: "Drafting",
    review: "Review",
    done: "Done",
    archived: "Archived",
  } satisfies Record<Status, string>,
  itemActions: {
    open: "Open",
    moveTo: "Move to",
    showFolder: "Show folder",
    archive: "Archive",
    archived: (titles: readonly string[]) =>
      titles.length === 1 ? `Archived "${titles[0]}"` : `Archived ${titles.length} videos`,
    undo: "Undo",
  },
  board: {
    title: "Videos",
    loadError: "Could not load the videos",
    layout: "Layout",
    gallery: "Gallery",
    board: "Board",
    count: (count: number) => (count === 1 ? "1 video" : `${count} videos`),
    allFormats: "All templates",
    filterByFormat: "Filter by template",
    archived: "Archived",
    emptyTitle: "Create your first video — the agent will make it",
    emptyBody:
      "Say what to make. Your agent reads your brief first, and you review the result here and ask for changes.",
    /** On the empty board: the material the agent learned, which opens the brief. */
    known: (titles: ReadonlyArray<string>) =>
      titles.length === 1
        ? `Your agent knows ${titles[0]}`
        : `Your agent knows ${titles.length} sources`,
    /** While the agent reads the first launch's material into about.md. */
    reading: (titles: ReadonlyArray<string>) =>
      titles.length === 1
        ? `Your agent is reading ${titles[0]}…`
        : `Your agent is reading ${titles.length} sources…`,
    /** Over the first videos the agent suggests from what it read; one opens New video with it. */
    ideasTitle: "Start your first video with one of these",
    ideasFrom: (titles: ReadonlyArray<string>) =>
      titles.length === 1
        ? `Your agent read ${titles[0]} and picked these`
        : `Your agent read ${titles.length} sources and picked these`,
    /** Under an idea: where it goes and how long it runs. */
    ideaMeta: (platform: string | undefined, seconds: number | undefined) =>
      [platform, seconds === undefined ? undefined : `${seconds} seconds`]
        .filter((part) => part !== undefined)
        .join(" · "),
    /** The request an idea writes into New video. */
    ideaPrompt: (platform: string | undefined, seconds: number | undefined, title: string) => {
      const lead = [seconds === undefined ? undefined : `${seconds}-second`, platform]
        .filter((part) => part !== undefined)
        .join(" ");

      return lead === "" ? title : `A ${lead}: ${title}`;
    },
    make: "Make",
    writeOwn: "I'll write my own",
    emptyColumn: "Nothing here",
    openFeedback: (count: number) => `${count} open`,
    selected: "selected",
    selectedCount: (count: number) => `${count} videos selected`,
    learnHint: {
      title: "Teach your agent about your product",
      body: "Paste a link to your app or site, or point at a project folder. The next videos will fit it better.",
      action: "Add material",
      dismiss: "Not now",
    },
  },
  newItem: {
    open: "New video",
    title: "New video",
    description:
      "Say what to make. The agent starts on it right away. Add files and links it should use.",
    promptLabel: "What video should we make?",
    promptPlaceholder:
      "A 30-second video showing the new reminders screen, like https://youtu.be/…",
    files: "Files",
    drop: "Drop files here, or click to browse",
    removeFile: (name: string) => `Remove ${name}`,
    videoLink: "Video · downloaded into the video's files",
    pageLink: "Link · passed to the agent",
    removeLink: "Remove link",
    untitled: "New video",
    uploadFailed: (name: string, message: string) => `Couldn't add ${name}: ${message}`,
    filesFailed: (message: string) => `Couldn't add the files: ${message}`,
    linkFailed: (link: string) => `Couldn't download ${link}. The agent gets the link instead.`,
    sendFailed: "The video was made, but the request couldn't reach the agent",
    format: "Template",
    noFormat: "No template",
    optional: "Optional",
    formatHint: "A template gives the agent a structure to follow.",
    required: "Required",
    choose: "Choose…",
    none: "None",
    createError: "Could not create the video",
    creating: "Creating…",
    uploading: "Adding files…",
    downloading: "Downloading videos…",
    sending: "Starting…",
    create: "Create and start",
    /** A request a `cutfac://new` link on a web page filled in, and the name the page gave. */
    fromLink: (source: string | undefined) =>
      source === undefined
        ? "Filled in from a link on a web page. Check it before you start."
        : `Filled in from a link (${source}). Check it before you start.`,
    linkHeld: "A link brought another request. Your draft is kept.",
    useLink: "Use the link's request",
  },
};

export type BoardMessages = typeof boardEn;
