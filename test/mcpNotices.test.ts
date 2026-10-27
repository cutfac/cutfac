import { describe, expect } from "bun:test";
import { join } from "node:path";

import { Effect, FileSystem, Layer, Schema } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { type McpServer, mcpServer, Overview, upToDateAgents } from "./mcpClient.ts";
import { FakeAgentDir, fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("mcp"), fakeAgents));

const Brief = Schema.Struct({
  path: Schema.String,
  purpose: Schema.optional(Schema.String),
  platforms: Schema.Array(Schema.String),
  body: Schema.String,
});

const Skill = Schema.Struct({
  markdown: Schema.String,
  copies: Schema.Array(Schema.Struct({ path: Schema.String, state: Schema.String })),
});

const FormatList = Schema.Struct({
  formats: Schema.Array(Schema.Struct({ id: Schema.String })),
  notices: Schema.Array(Schema.String),
});

/** The overview also notices a missing brief, which most of these tests are not about. */
const briefed = (server: McpServer) =>
  server.call("update_brief", { purpose: "promote", body: "Videos for my app." }, Brief);

describe("what the MCP server tells the agent to look at", () => {
  it.live(
    "points agents at a missing brief, and lets them write it from what the user says",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const before = yield* server.call("workspace_overview", {}, Overview);

        expect(before.notices).toHaveLength(1);
        expect(before.notices[0]).toContain(join(ws.root, "brief.md"));
        expect(before.notices[0]).toContain("update_brief");

        yield* server.call(
          "update_brief",
          { purpose: "promote", platforms: ["tiktok"], body: "Videos for my app." },
          Brief,
        );
        const brief = yield* server.call("update_brief", { platforms: ["tiktok", "reels"] }, Brief);

        expect(brief).toEqual({
          path: join(ws.root, "brief.md"),
          purpose: "promote",
          platforms: ["tiktok", "reels"],
          body: "Videos for my app.",
        });
        expect(yield* fs.readFileString(brief.path)).toContain("platforms:\n  - tiktok\n  - reels");
        expect((yield* server.call("workspace_overview", {}, Overview)).notices).toEqual([]);
      }),
    20_000,
  );

  it.live(
    "tells the agent when an installed agent is too old, and how to update it",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;
        const fakes = yield* FakeAgentDir;

        yield* fakes.bin("claude", 'echo "2.1.1 (Claude Code)"\n');
        yield* fakes.bin("codex", 'echo "codex-cli 99.0.0"\n');
        const server = yield* mcpServer(ws.root);

        yield* briefed(server);

        const { notices } = yield* server.call("workspace_overview", {}, Overview);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain("Claude Code 2.1.1");
        expect(notices[0]).toContain("`claude update`");
      }),
    30_000,
  );

  it.live(
    "keeps the workspace skill current and tells the agent about an edited copy",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        yield* briefed(server);

        const bundled = yield* fs.readFileString(
          join(import.meta.dir, "../skills/cutfac/SKILL.md"),
        );

        const copy = join(ws.root, ".claude/skills/cutfac/SKILL.md");

        // The server installed it on start.
        expect(yield* fs.readFileString(copy)).toBe(bundled);
        expect((yield* server.call("workspace_overview", {}, Overview)).notices).toEqual([]);

        yield* fs.writeFileString(copy, `${bundled}\n- My own rule.\n`);

        const { notices } = yield* server.call("workspace_overview", {}, Overview);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toContain(".claude/skills/cutfac/SKILL.md");

        const skill = yield* server.call("get_skill", {}, Skill);

        expect(skill.markdown).toBe(bundled);
        expect(skill.copies.map((c) => c.state)).toEqual(["current", "edited"]);
        expect(skill.copies.every((c) => c.path.startsWith("/"))).toBe(true);
      }),
    20_000,
  );

  it.live(
    "tells the agent about a format.yaml that doesn't read, and still lists the rest",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        yield* ws.writeText("formats/fine/format.yaml", "title: Fine\n");
        yield* ws.writeText("formats/half-done/format.yaml", "summary: no title here\n");

        const { notices } = yield* server.call("workspace_overview", {}, Overview);
        const listed = yield* server.call("list_formats", {}, FormatList);

        expect(listed.formats.map((f) => f.id)).toEqual(["fine"]);
        expect(listed.notices).toHaveLength(1);
        expect(listed.notices[0]).toContain("formats/half-done/format.yaml");
        expect(listed.notices[0]).toContain("check_format");
        expect(notices).toContain(listed.notices[0] ?? "");
      }),
    20_000,
  );
});
