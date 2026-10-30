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
    rename: "Rename",
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
    /** The request a suggested first video writes into the request box. */
    ideaPrompt: (platform: string | undefined, seconds: number | undefined, about: string) => {
      const lead = [seconds === undefined ? undefined : `${seconds}-second`, platform ?? "video"]
        .filter((part) => part !== undefined)
        .join(" ");

      return `Make a ${lead}. ${about}`;
    },
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
    untitled: "New video",
  },
};

export type BoardMessages = typeof boardEn;
