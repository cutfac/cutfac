export const shellEn = {
  common: {
    somethingWrong: "Something went wrong",
    cancel: "Cancel",
    close: "Close",
    copy: "Copy",
    couldNotCopy: (message: string) => `Could not copy: ${message}`,
  },
  app: {
    unreachable: "Cannot reach the Cutfac server",
  },
  nav: {
    appName: "Cutfac",
    openWorkspace: "Open workspace…",
    newVideo: "New video",
    main: "Main",
    board: "Videos",
    learn: "Brief",
    templates: "Templates",
    setup: "Setup",
    sendFeedback: "Send feedback",
    resize: "Resize the sidebar",
    videos: "Videos",
    inProgress: "In progress",
    allVideos: "All videos",
    toggle: "Toggle sidebar",
    back: "Back",
    forward: "Forward",
    waiting: (count: number) =>
      count === 1 ? "1 video waits for you" : `${count} videos wait for you`,
    videoTitle: (title: string, status: string, state: string | undefined) =>
      state === undefined ? `${title} (${status})` : `${title} (${status}, ${state})`,
  },
  palette: {
    title: "Command palette",
    description: "Find a video, a page or a command.",
    placeholder: "Search videos and commands…",
    empty: "Nothing matches.",
    thisVideo: "This video",
    actions: "Actions",
    goTo: "Go to",
  },
  language: {
    label: "Language",
  },
  teamFeedback: {
    title: "Send feedback",
    description:
      "Tell the people who make Cutfac about a bug, a confusing step, or something you wish it did. We read every message.",
    messageLabel: "Message",
    placeholder: "What happened, or what would help?",
    emailLabel: "Email for a reply",
    emailHint: "Optional. Leave it empty to stay anonymous.",
    send: "Send",
    failed: "Could not send feedback",
    sent: "Thanks! Your feedback reached the Cutfac team.",
    /** Shows under a message box while its text starts with `/feedback`. */
    slashHint: "/feedback sends the rest of the message to the Cutfac team, not to your agent.",
    slashEmpty: "Write what to tell us after /feedback.",
    logsHint:
      "The log is what the app did lately and any errors, which helps us find the cause. Never a video, a prompt, a chat or a key.",
    showLogs: "See what's sent",
    /** Only says what the log holds; it picks nothing. */
    recentErrors: (count: number) =>
      `The app hit ${count === 1 ? "an error" : `${count} errors`} lately. Sending the log with it helps us find the cause much faster.`,
    sendWithLog: "Send with log",
    sendWithoutLog: "Send without log",
  },
};

export type ShellMessages = typeof shellEn;
