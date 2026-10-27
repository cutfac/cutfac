import { expect, test } from "bun:test";

import { Context } from "effect";
import { Tool } from "effect/ai";

import { MCP_READ_TOOLS, MCP_WRITE_TOOLS, type McpLaunch } from "../src/core/agents.ts";
import {
  claudeImportFlags,
  codexImportConfig,
  codexImportPermissions,
} from "../src/core/importRun.ts";
import type { CodexListed } from "../src/core/mcpServers.ts";
import { CutfacToolkit } from "../src/mcp/server.ts";

const SERVER: McpLaunch = { command: "cutfac", args: ["mcp", "--workspace", "/w"] };

/** The value after `flag` in an argument list. */
const valueOf = (args: ReadonlyArray<string>, flag: string) => args[args.indexOf(flag) + 1] ?? "";

const READ_TOOLS: ReadonlySet<string> = new Set(MCP_READ_TOOLS);

const WRITE_TOOLS: ReadonlySet<string> = new Set(MCP_WRITE_TOOLS);

test("every MCP tool is either a read tool or a write tool, matching its readonly annotation", () => {
  const tools = Object.values(CutfacToolkit.tools);

  expect(tools.length).toBe(MCP_READ_TOOLS.length + MCP_WRITE_TOOLS.length);

  for (const tool of tools) {
    const readonly = Context.get(tool.annotations, Tool.Readonly);
    const reads = READ_TOOLS.has(tool.name);

    expect({ name: tool.name, readonly }).toEqual({ name: tool.name, readonly: reads });
    expect(reads).not.toBe(WRITE_TOOLS.has(tool.name));
  }
});

const LINK = "https://packs.example.com/reels";

test("Claude reads only, with only this workspace's server, until the user allows", () => {
  const args = claudeImportFlags("read", SERVER, LINK);
  const tools = valueOf(args, "--tools").split(",");
  const allowed = valueOf(args, "--allowedTools").split(",");
  const denied = valueOf(args, "--disallowedTools").split(",");

  expect(tools).not.toContain("Write");
  expect(tools).not.toContain("Edit");
  expect(tools.some((tool) => tool.startsWith("Bash"))).toBe(false);
  expect(allowed.some((tool) => tool.startsWith("Bash"))).toBe(false);
  expect(allowed).toContain("mcp__cutfac__get_skill");
  expect(allowed).not.toContain("mcp__cutfac__save_format");
  expect(denied).toContain("mcp__cutfac__save_format");
  expect(denied).toContain("mcp__cutfac__create_item");
  expect(args).toContain("--strict-mcp-config");

  expect(JSON.parse(valueOf(args, "--mcp-config"))).toEqual({
    mcpServers: { cutfac: SERVER },
  });
});

test("an import never reads outside the workspace, credentials, or .env files", () => {
  for (const phase of ["read", "install"] as const) {
    const args = claudeImportFlags(phase, SERVER, LINK);
    const denied = valueOf(args, "--disallowedTools").split(",");
    const settings = JSON.parse(valueOf(args, "--settings"));

    expect(settings.permissions).toEqual({ blockReadsOutsideWorkingDirectories: true });
    expect(denied).toContain("Read(~/.ssh/**)");
    expect(denied).toContain("Read(./.env)");
    expect(denied).toContain("Read(./**/.env.*)");
  }
});

test("after Allow, Claude's shell commands run in the sandbox, reaching only the link's host and code hosts", () => {
  const { sandbox } = JSON.parse(valueOf(claudeImportFlags("install", SERVER, LINK), "--settings"));

  expect(sandbox).toMatchObject({
    enabled: true,
    failIfUnavailable: true,
    allowUnsandboxedCommands: false,
    autoAllowBashIfSandboxed: false,
    network: { strictAllowlist: true },
  });

  expect(sandbox.network.allowedDomains).toContain("packs.example.com");
  expect(sandbox.network.allowedDomains).toContain("github.com");

  const reading = JSON.parse(valueOf(claudeImportFlags("read", SERVER, LINK), "--settings"));

  expect(reading.sandbox).toBeUndefined();
});

test("after Allow, Claude may fetch and write in the workspace, but not run what it fetched", () => {
  const args = claudeImportFlags("install", SERVER, LINK);
  const tools = valueOf(args, "--tools").split(",");
  const allowed = valueOf(args, "--allowedTools").split(",");

  expect(tools).toContain("Write");
  expect(tools).toContain("Bash");
  expect(allowed).toContain("Edit(./**)");
  expect(allowed).not.toContain("Write");
  expect(allowed).not.toContain("Bash");
  expect(allowed).toContain("Bash(git clone:*)");
  expect(allowed).not.toContain("Bash(npx:*)");
  expect(allowed.some((tool) => tool.startsWith("Bash(git -C"))).toBe(false);
  expect(allowed).toContain("mcp__cutfac");
  expect(args).toContain("--strict-mcp-config");
});

/** Servers as Codex lists them, all on. */
const listing = (...names: string[]): CodexListed[] =>
  names.map((name) => ({ name, enabled: true, transport: "stdio", entry: { type: "stdio" } }));

test("Codex reads only, with every other MCP server off, until the user allows", () => {
  const config = codexImportConfig("read", SERVER, "cutfac-x", listing("github", "a.b"));

  expect(codexImportPermissions("read")).toEqual({ sandbox: "read-only", approvalPolicy: "never" });
  expect(config).toContain("features.apps=false");
  expect(config).toContain("mcp_servers.github.enabled=false");
  expect(config).toContain('mcp_servers."a.b".enabled=false');
  expect(config).toContain('mcp_servers.cutfac-x.command="cutfac"');

  expect(config).toContain(`mcp_servers.cutfac-x.enabled_tools=${JSON.stringify(MCP_READ_TOOLS)}`);

  expect(config.some((entry) => entry.includes("network_access"))).toBe(false);
});

test("after Allow, Codex may write in the workspace and reach the network", () => {
  const config = codexImportConfig("install", SERVER, "cutfac-x", listing("github"));

  expect(codexImportPermissions("install")).toEqual({
    sandbox: "workspace-write",
    approvalPolicy: "never",
  });
  expect(config).toContain("sandbox_workspace_write.network_access=true");
  expect(config).toContain("mcp_servers.github.enabled=false");
  expect(config.some((entry) => entry.includes("enabled_tools"))).toBe(false);
});

test("neither phase of an import may send feedback to the Cutfac team", () => {
  for (const phase of ["read", "install"] as const) {
    const denied = valueOf(claudeImportFlags(phase, SERVER, LINK), "--disallowedTools").split(",");
    const config = codexImportConfig(phase, SERVER, "cutfac-x", []);

    expect(denied).toContain("mcp__cutfac__send_feedback_to_cutfac");
    // Codex asks before it, and with no one to ask, an import turn declines it.
    expect(config).toContain(
      'mcp_servers.cutfac-x.tools.send_feedback_to_cutfac.approval_mode="prompt"',
    );
    expect(codexImportPermissions(phase).approvalPolicy).toBe("never");
  }
});
