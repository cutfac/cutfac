#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { stringify } from "yaml";
import { runStdio } from "./mcp/server.ts";
import { addReference } from "./core/references.ts";
import { createApp } from "./server/app.ts";
import { CONFIG_FILE, Workspace } from "./core/workspace.ts";

const PACKAGE_ROOT = resolve(import.meta.dir, "..");
const USAGE = `content-factory — local short-form content factory

Usage:
  factory init [dir] [--name <name>] [--items <path>]   Create factory.yaml, product/, and agent setup
  factory serve [--port 4317] [--workspace <dir>]        Web UI + API (needs \`bun run build\` once)
  factory mcp [--workspace <dir>]                        MCP server over stdio for Claude Code / Codex
  factory ref add <file|url> [--title <t>]              Add a reference video and preprocess it
  factory agent-setup [--workspace <dir>]               Print MCP setup commands for Claude Code and Codex
`;

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function positional(args: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      if (!["--dev"].includes(a)) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;
  const wsDir = flag(args, "workspace") ?? process.cwd();
  switch (command) {
    case "init":
      return init(resolve(positional(args)[0] ?? "."), args);
    case "serve": {
      const ws = await Workspace.open(wsDir);
      const port = Number(flag(args, "port") ?? 4317);
      const webDir = join(PACKAGE_ROOT, "dist/web");
      const hasWeb = existsSync(join(webDir, "index.html"));
      Bun.serve({ port, fetch: createApp(ws, hasWeb ? { webDir } : {}).fetch, idleTimeout: 0 });
      console.log(`Content Factory · ${ws.config.name}`);
      console.log(`  workspace  ${ws.root}`);
      console.log(
        `  web        http://localhost:${port}${hasWeb ? "" : "  (API only — run `bun run build` or `bun run dev:web`)"}`,
      );
      return;
    }
    case "mcp":
      return runStdio(await Workspace.open(wsDir));
    case "ref": {
      const [sub, source] = positional(args);
      if (sub !== "add" || !source) throw new Error("Usage: factory ref add <file|url>");
      const ws = await Workspace.open(wsDir);
      const title = flag(args, "title");
      const src = /^https?:\/\//.test(source)
        ? { kind: "url" as const, url: source }
        : { kind: "file" as const, path: resolve(source) };
      const ref = await addReference(ws, src, title ? { title } : {});
      console.log(`Added reference ${ref.id} → ${ws.abs(ref.dir)}`);
      return;
    }
    case "agent-setup":
      return printAgentSetup(await Workspace.open(wsDir));
    default:
      console.log(USAGE);
  }
}

async function init(dir: string, args: string[]): Promise<void> {
  await mkdir(dir, { recursive: true });
  const configPath = join(dir, CONFIG_FILE);
  if (existsSync(configPath)) {
    console.log(`${CONFIG_FILE} already exists in ${dir}`);
  } else {
    const items = flag(args, "items");
    await writeFile(
      configPath,
      stringify({
        name: flag(args, "name") ?? basename(dir),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platforms: ["tiktok", "instagram", "youtube"],
        ...(items ? { paths: { items } } : {}),
      }),
    );
    console.log(`Created ${configPath}`);
  }
  const ws = await Workspace.open(dir);
  const productFile = `${ws.config.paths.product}/product.yaml`;
  if (!ws.exists(productFile)) {
    await ws.writeText(
      productFile,
      await readFile(join(PACKAGE_ROOT, "templates/product.yaml"), "utf8"),
    );
    await ws.mkdir(`${ws.config.paths.product}/captures`);
    console.log(`Created ${productFile} — fill this in first; every agent run reads it.`);
  }
  for (const p of [ws.config.paths.references, ws.config.paths.formats, ws.config.paths.items])
    await ws.mkdir(p);
  await installSkill(ws);
  printAgentSetup(ws);
}

/** Copy the agent skill into the workspace for both Claude Code and Codex-style agents. */
async function installSkill(ws: Workspace): Promise<void> {
  const skill = await readFile(join(PACKAGE_ROOT, "skills/content-factory/SKILL.md"), "utf8");
  for (const target of [
    ".agents/skills/content-factory/SKILL.md",
    ".claude/skills/content-factory/SKILL.md",
  ]) {
    if (ws.exists(target)) continue;
    await ws.writeText(target, skill);
    console.log(`Installed skill → ${target}`);
  }
}

function printAgentSetup(ws: Workspace): void {
  const cli = join(PACKAGE_ROOT, "src/cli.ts");
  console.log(`
Connect your agent (run inside ${ws.root}):

  Claude Code:
    claude mcp add content-factory -- bun ${cli} mcp --workspace ${ws.root}

  Codex (~/.codex/config.toml):
    [mcp_servers.content-factory]
    command = "bun"
    args = ["${cli}", "mcp", "--workspace", "${ws.root}"]

Then open the board:  bun ${cli} serve --workspace ${ws.root}
`);
}

main(process.argv.slice(2)).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
