/** Turning the MCP servers the user set up for their agents on or off for runs from the board. */
export const mcpEn = {
  title: "MCP servers for runs from the board",
  body: "Your Claude Code and Codex have these servers and plugins set up. Runs you start from the board use only the ones you turn on here, with all of their tools, so look over what each one starts first.",
  footnote:
    "Servers from claude.ai connectors don't load in runs from the board. Plugins' skills always load; only their servers wait for you here.",
  error: "Could not read your agents' MCP servers",
  problems: "Some of your agents' MCP setup couldn't be read",
  sources: {
    user: "All workspaces",
    local: "This folder only",
    project: "This workspace's .mcp.json",
  },
  states: {
    on: "On",
    off: "Off",
    new: "New",
    changed: "Changed",
  },
  /** Under a server whose setup changed after the user turned it on. */
  changedNote:
    "Its setup changed after you turned it on, so it's off until you look it over again.",
  env: "Variables",
  headers: "Headers",
  helper: "Runs for its headers",
  turnOn: "Turn on",
  turnOff: "Turn off",
  keepOff: "Keep off",
  turnedOn: (name: string) => `${name} is on for runs from the board`,
  turnedOff: (name: string) => `${name} stays off for runs from the board`,
  failed: (name: string) => `Could not change ${name}`,
  plugin: {
    /** The title of a plugin the user hasn't decided on yet. */
    ask: (title: string) => `Use the ${title} plugin for video work?`,
    access: (title: string) => `With it on, video work can reach ${title}.`,
    use: "Use",
    skip: "Don't use",
    starts: (count: number) => (count === 1 ? "What it starts" : `What it starts (${count})`),
    turnedOn: (title: string) => `Video work can now use ${title}`,
    turnedOff: (title: string) => `Video work won't use ${title}`,
  },
};

export type McpMessages = typeof mcpEn;
