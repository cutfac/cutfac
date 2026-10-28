export const composerEn = {
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
        "Make a 15-second vertical video about my product",
        "Make a short teaser in the style of a video I taught you",
      ],
    },
    placeholder: {
      range: "What should change in this part?",
      box: "What should change in the box?",
      whole: "What should change? Select a part first to be precise.",
      answer: "Write your answer to the agent…",
      new: "Describe the video you want…",
    },
    promptCopied: "Prompt copied. Paste it into Claude Code or Codex in this workspace.",
    promptReady: "The prompt is ready to copy",
    clear: "Clear the selection",
    request: "Edit request",
    agent: "Send to",
    /** The model and reasoning effort the agent runs with; a default is the agent's own pick. */
    models: {
      model: "Model",
      effort: "Reasoning effort",
      defaultModel: "Default model",
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
    /** The composer's + button, which attaches files or adds a source. */
    add: "Add files or sources",
    sources: {
      menu: "Link or folder…",
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
    /** How many takes on the request the agent makes, to compare and pick from. */
    versions: {
      label: "Versions to make",
      count: (count: number) => (count === 1 ? "1 version" : `${count} versions`),
    },
    stop: "Stop the agent",
    send: "Send (Enter)",
  },
  /** Files the user drops, pastes or picks: kept with the item, and attached to a request. */
  attachments: {
    /** What a drop does on each area, shown while files are dragged over the window. */
    drop: {
      composer: "Attach",
      stage: "Attach to the chat",
      box: "Attach to the box request",
      references: "Add as reference files",
      media: "Add as new media",
      reply: "Attach to your reply",
      withLink: "Send with the link",
    },
    attach: "Attach files",
    uploading: "Uploading…",
    folder: (name: string, files: number) =>
      `${name}/ · ${files === 1 ? "1 file" : `${files} files`}`,
    detach: (name: string) => `Detach ${name}`,
    media: "Media",
    references: "Reference files",
    referencesEmpty: "Drop files here for agents to use",
    attachTile: (name: string) => `Attach ${name} to the chat`,
    remove: (name: string) => `Delete ${name}`,
    removed: "Deleted",
    undo: "Undo",
  },
};

export type ComposerMessages = typeof composerEn;
