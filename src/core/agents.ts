import { slugify, type Workspace } from "./workspace.ts";

export interface McpLaunch {
  command: string;
  args: string[];
}

export interface AgentConnection {
  agent: "claude" | "codex";
  ok: boolean;
  detail: string;
}

const SERVER_NAME = "content-factory";

/** How an agent should start this workspace's MCP server. */
export function mcpLaunch(cliPath: string, ws: Workspace): McpLaunch {
  return { command: "bun", args: [cliPath, "mcp", "--workspace", ws.root] };
}

/**
 * Claude Code reads project-scoped servers from .mcp.json at the workspace root,
 * so connecting never touches global config. Other servers in the file are kept.
 */
export async function connectClaude(ws: Workspace, launch: McpLaunch): Promise<AgentConnection> {
  const file = ".mcp.json";
  const current = ws.exists(file)
    ? (JSON.parse(await ws.readText(file)) as { mcpServers?: Record<string, unknown> })
    : {};
  const next = { ...current, mcpServers: { ...current.mcpServers, [SERVER_NAME]: launch } };
  await ws.writeText(file, `${JSON.stringify(next, null, 2)}\n`);
  return {
    agent: "claude",
    ok: true,
    detail: `${file} → open Claude Code in ${ws.root} and approve the "${SERVER_NAME}" server`,
  };
}

/**
 * Codex only reads MCP servers from its user config, so register through its own CLI
 * under a per-workspace name instead of editing ~/.codex/config.toml by hand.
 */
export async function connectCodex(
  ws: Workspace,
  launch: McpLaunch,
  run: (cmd: string[]) => Promise<{ code: number; output: string }> = runCommand,
): Promise<AgentConnection> {
  const codex = Bun.which("codex");
  if (!codex) return { agent: "codex", ok: false, detail: "codex CLI not found on PATH" };
  const name = codexServerName(ws);
  const existing = await run([codex, "mcp", "get", name]);
  if (existing.code === 0) await run([codex, "mcp", "remove", name]);
  const added = await run([codex, "mcp", "add", name, "--", launch.command, ...launch.args]);
  if (added.code !== 0) return { agent: "codex", ok: false, detail: added.output.trim() };
  return { agent: "codex", ok: true, detail: `registered "${name}" in ~/.codex/config.toml` };
}

export function codexServerName(ws: Workspace): string {
  return `${SERVER_NAME}-${slugify(ws.config.name) || "workspace"}`;
}

async function runCommand(cmd: string[]): Promise<{ code: number; output: string }> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, output: stdout + stderr };
}

export interface AgentStatus {
  agent: "claude" | "codex";
  installed: boolean;
  connected: boolean;
}

/** Whether each supported agent CLI is installed and already pointed at this workspace. */
export async function agentStatus(
  ws: Workspace,
  run: (cmd: string[]) => Promise<{ code: number; output: string }> = runCommand,
): Promise<AgentStatus[]> {
  let claudeConnected = false;
  if (ws.exists(".mcp.json")) {
    try {
      const config = JSON.parse(await ws.readText(".mcp.json")) as {
        mcpServers?: Record<string, unknown>;
      };
      claudeConnected = Boolean(config.mcpServers?.[SERVER_NAME]);
    } catch {
      claudeConnected = false;
    }
  }
  const codex = Bun.which("codex");
  const codexConnected = codex
    ? (await run([codex, "mcp", "get", codexServerName(ws)])).code === 0
    : false;
  return [
    { agent: "claude", installed: Boolean(Bun.which("claude")), connected: claudeConnected },
    { agent: "codex", installed: Boolean(codex), connected: codexConnected },
  ];
}
