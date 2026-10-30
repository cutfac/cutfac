export const editorEn = {
  item: {
    openError: "Cannot open this video",
    /** Saves a copy of the finished file shown; the agent renders it with every edit. */
    download: "Export",
    /** After an export, when the file breaks a platform's upload rule. */
    uploadWarning: "Exported, but this video may not upload as it is",
    imageHint: "Drag on the image to mark the area an edit is about.",
    chat: "Chat",
    details: "Details",
    editing: (agent: string) => `${agent} is editing`,
    /** The agent waits on the user: for an answer to its questions, or an OK to use a tool. */
    asking: (agent: string, question: boolean) =>
      `${agent} is waiting for your ${question ? "answer" : "OK"}`,
    status: "Status",
    noMediaTitle: "No video yet",
    noMediaBody: "Drop footage or an image here if you have some to start from.",
    making: (agent: string) => `${agent} is making the first version`,
    makingBody: "It shows here once it's rendered. Follow along in the chat.",
    addMedia: "Add a video or image",
    add: "Add",
    format: "Template",
    title: "Title",
    hook: "Hook",
    notes: "Notes",
    hookPlaceholder: "The line that makes people stay",
    notesPlaceholder: "Anything worth remembering about this video",
    titleRequired: "The title cannot be empty.",
  },
  layout: {
    /** The panel of chat and details, as the editor's sections name it. */
    chat: "Chat panel",
    move: (section: string) => `Move ${section}`,
    place: (section: string) => `Where ${section} goes`,
    below: "Below the preview",
    left: "Left of the preview",
    right: "Right of the preview",
    leftEdge: "Left side of the window",
    rightEdge: "Right side of the window",
    swap: "Swap the order",
    reset: "Reset the layout",
    narrow: "The window is too narrow for this",
    folded: "Moved down for now, as the window is narrow. It goes back once the window is wider.",
    resize: "Drag to resize, double-click to reset",
  },
  history: {
    undo: "Undo",
    redo: "Redo",
    title: "Version history",
    close: "Close version history",
    running:
      "An agent is working on this video. Wait for it or stop it before restoring a version.",
    emptyTitle: "No versions yet",
    emptyBody: "Each time the video changes, the version it became lands here.",
    hint: "Click a version to preview it, and restore it if you want it back. The current one stays too.",
    now: "Current",
    request: (number: number) => `Request #${number}`,
    /** Opens the versions a request went through before its last. */
    more: (count: number) => `${count} more`,
    goneRequest: "Deleted request",
    picked: "Picked version",
    original: (media?: string) => (media === undefined ? "Original" : `Original ${media}`),
    edited: (media?: string) => (media === undefined ? "Agent's edit" : `Edit to ${media}`),
    rolledBack: (media?: string) =>
      media === undefined ? "Rolled back to before" : `Rolled ${media} back to before`,
    restored: (media?: string) =>
      media === undefined ? "Restored an earlier version" : `Restored an earlier ${media}`,
    outside: (media?: string) =>
      media === undefined ? "Changed outside a request" : `Changed ${media} outside a request`,
    earlier: "Earlier version",
    previewing: "Previewing",
    restore: "Restore this version",
    stopPreview: "Back to current",
  },
  shortcuts: {
    open: "Keyboard shortcuts",
    title: "Keyboard shortcuts",
    description: "Single keys work whenever you are not typing in a field.",
    playback: "Playback",
    playPause: "Play or pause",
    step: "Step one frame",
    stepLong: "Step ten frames",
    mute: "Mute or unmute",
    toStart: "Go to the start",
    toEnd: "Go to the end",
    selection: "Selection",
    markIn: "Start the selection at the playhead",
    markOut: "End the selection at the playhead",
    toIn: "Go to the selection's start",
    toOut: "Go to the selection's end",
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
  compare: {
    open: "Compare",
    title: "Before and after",
    before: "Before",
    after: "After",
    image: (media: string | undefined, side: string) => `${media ?? "Media"}, ${side}`,
    playBoth: (time: string) => `Play both from ${time}`,
    /** Plays every video over the part the request pointed at, again and again. */
    loopTogether: (range: string) => `Loop ${range} together`,
    hear: "Hear this one",
    restore: "Restore before",
    keep: "Keep the edit",
  },
  /** The agent's versions of one request side by side, to keep one or none. */
  versions: {
    title: "Compare versions",
    /** The media as it was before the request. */
    original: "Original",
    sideBySide: "Side by side",
    /** The version the media holds now. */
    inUse: "In use",
    use: "Use this",
    playAll: (time: string) => `Play all from ${time}`,
  },
  transport: {
    play: "Play",
    pause: "Pause",
    mute: "Mute",
    unmute: "Unmute",
    loop: "Loop the selection",
    loopHint: "Play the selection over and over",
    hint: "Drag on the timeline to select a part · drag on the video to mark an area",
  },
  target: {
    /** Follows a range in a selection's summary: `0:01.0–0:02.0 · box at 0:04.0`. */
    boxAt: (time: string) => `box at ${time}`,
    boxMarker: (time: string) => `Box at ${time}`,
    goToBox: "Go to the frame this box is on",
    removeBox: "Remove the box",
  },
  /** The steps that walk a new user through editing a sample, one card at a time. */
  guide: {
    label: "Try editing the sample",
    of: (step: number, total: number) => `${step} of ${total}`,
    close: "Close the guide",
    play: {
      title: "Play the sample",
      body: "Press Space or the play button and watch it through.",
    },
    select: {
      title: "Draw a box around the title",
      body: "Drag over the big title on the video. A box marks what to change.",
    },
    ask: {
      title: "Say what to change",
      body: "Pick the suggestion in the box's request and send it. Your agent changes the code and renders it again.",
      suggestion: "Change this text to our product's name",
    },
    variants: {
      title: "Ask for a few versions",
      body: "Once it's done, draw a box somewhere else, set versions to 2 and send. Compare them side by side and keep the one you like.",
    },
    done: {
      title: "That's the whole loop",
      body: "Now make your own video from scratch. Your agent suggests ideas from what it read about you.",
      make: "Make my own video",
    },
  },
};

export type EditorMessages = typeof editorEn;
