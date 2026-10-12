import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parse, stringify } from "yaml";
import type { z } from "zod";
import { WorkspaceConfig } from "./schema.ts";

export const CONFIG_FILE = "factory.yaml";

/**
 * All filesystem access for a workspace goes through this class so a hosted
 * runtime can later swap the backing store. Callers only see workspace-relative paths.
 */
export class Workspace {
  private constructor(
    readonly root: string,
    readonly config: WorkspaceConfig,
  ) {}

  static async open(start: string = process.cwd()): Promise<Workspace> {
    const root = findRoot(resolve(start));
    if (!root) {
      throw new Error(
        `No ${CONFIG_FILE} found in ${start} or any parent. Run \`factory init\` first.`,
      );
    }
    const raw = parse(await readFile(join(root, CONFIG_FILE), "utf8")) ?? {};
    return new Workspace(root, WorkspaceConfig.parse(raw));
  }

  /** Resolve a workspace-relative path, refusing anything that escapes the root. */
  abs(rel: string): string {
    if (isAbsolute(rel)) throw new Error(`Expected a workspace-relative path, got ${rel}`);
    const full = resolve(this.root, rel);
    if (full !== this.root && !full.startsWith(this.root + sep)) {
      throw new Error(`Path escapes workspace: ${rel}`);
    }
    return full;
  }

  rel(abs: string): string {
    return relative(this.root, abs).split(sep).join("/");
  }

  exists(rel: string): boolean {
    return existsSync(this.abs(rel));
  }

  async readText(rel: string): Promise<string> {
    return readFile(this.abs(rel), "utf8");
  }

  async writeText(rel: string, text: string): Promise<void> {
    const full = this.abs(rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }

  async readYaml<S extends z.ZodType>(rel: string, schema: S): Promise<z.infer<S>> {
    return schema.parse(parse(await this.readText(rel)) ?? {});
  }

  async writeYaml(rel: string, value: unknown): Promise<void> {
    await this.writeText(rel, stringify(stripUndefined(value), { lineWidth: 100 }));
  }

  async mkdir(rel: string): Promise<void> {
    await mkdir(this.abs(rel), { recursive: true });
  }

  async list(rel: string): Promise<{ name: string; dir: boolean; size: number; mtime: number }[]> {
    if (!this.exists(rel)) return [];
    const entries = await readdir(this.abs(rel), { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (e.name.startsWith(".")) continue;
      const s = await stat(join(this.abs(rel), e.name));
      out.push({ name: e.name, dir: e.isDirectory(), size: s.size, mtime: s.mtimeMs });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function findRoot(start: string): string | undefined {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function stripUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => [k, stripUndefined(v)]),
    );
  }
  return value;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "untitled"
  );
}

export const nowIso = (): string => new Date().toISOString();
