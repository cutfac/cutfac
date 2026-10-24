/** Turning the MCP servers and plugins the user set up for their agents on or off for video work. */
export const mcpEn = {
  title: "Tools for video work",
  body: "These MCP servers and plugins are set up in your Claude Code and Codex. Work you start from the board uses only the ones you turn on here, with all of their tools, so look over what each one runs first.",
  footnote: "claude.ai connectors aren't listed here. A plugin's skills still load while it's off.",
  error: "Could not read your agents' MCP servers",
  problems: "Some of your agents' MCP setup couldn't be read",
  /** On the sidebar's Setup row while some wait for the user. */
  waiting: (count: number) => `${count} waiting for you to decide`,
  sources: {
    user: "All workspaces",
    local: "This folder only",
    project: "This workspace's .mcp.json",
  },
  /** Under a server whose setup changed after the user turned it on. */
  changedNote:
    "Its setup changed after you turned it on, so it's off until you look it over again.",
  starts: "What it runs",
  env: "Variables",
  headers: "Headers",
  helper: "Runs for its headers",
  use: "Use",
  skip: "Don't use",
  /** The switch of one the user already decided on. */
  toggle: (name: string) => `Use ${name} for video work`,
  server: {
    /** The title of a server the user hasn't decided on yet. */
    ask: (name: string) => `Use the ${name} server for video work?`,
    access: "With it on, your agent can use all of its tools during video work.",
    turnedOn: (name: string) => `Video work now uses the ${name} server`,
    turnedOff: (name: string) => `Video work won't use the ${name} server`,
    failed: (name: string) => `Could not change the ${name} server`,
  },
  plugin: {
    ask: (title: string) => `Use the ${title} plugin for video work?`,
    access: (title: string) => `With it on, your agent can reach ${title} during video work.`,
    turnedOn: (title: string) => `Video work now uses the ${title} plugin`,
    turnedOff: (title: string) => `Video work won't use the ${title} plugin`,
    failed: (title: string) => `Could not change the ${title} plugin`,
  },
};

export type McpMessages = typeof mcpEn;
