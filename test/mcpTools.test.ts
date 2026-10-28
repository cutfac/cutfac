import { describe, expect } from "bun:test";

import { Context, Effect, FileSystem, Layer, Schema } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { mcpServer, Overview, upToDateAgents } from "./mcpClient.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("mcp"), fakeAgents));

const ToolList = Schema.Struct({ tools: Schema.Array(Schema.Struct({ name: Schema.String })) });

const Created = Schema.Struct({ id: Schema.String });

const Updated = Schema.Struct({ status: Schema.String });

const FreeVersion = Schema.Struct({ freeVersion: Schema.optional(Schema.String) });

const FormatDetail = Schema.Struct({
  id: Schema.String,
  readme: Schema.optional(Schema.String),
});

const FormatCheck = Schema.Struct({
  ready: Schema.Boolean,
  problems: Schema.Array(Schema.Struct({ kind: Schema.String, subject: Schema.String })),
});

const ItemInputs = Schema.Struct({
  doc: Schema.Struct({ inputs: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
});

describe("the MCP server's tools", () => {
  it.live(
    "lists the workspace tools",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const { tools } = yield* server.request("tools/list", {}, ToolList);
        const names = tools.map((tool) => tool.name);

        expect(names).toContain("create_item");
        expect(names).toContain("update_item");
        expect(names).not.toContain("set_schedule");
        expect(names).toContain("workspace_overview");
        expect(names).toContain("check_format");
        expect(names).toContain("get_skill");
        expect(names).toContain("review_media");
        expect(names).toContain("send_feedback_to_cutfac");
        expect(names).toContain("update_brief");
        expect(names).toContain("render");
      }),
    20_000,
  );

  it.live(
    "agents can create an item and hand it over for review",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const created = yield* server.call(
          "create_item",
          { title: "First post", format: "demo" },
          Created,
        );

        expect(created.id).toBe("demo/first-post");

        const updated = yield* server.call(
          "update_item",
          { id: created.id, status: "review", hook: "One move wins" },
          Updated,
        );

        expect(updated.status).toBe("review");

        const overview = yield* server.call("workspace_overview", {}, Overview);

        expect(overview.items).toEqual({ review: 1 });
      }),
    20_000,
  );

  it.live(
    "a tool error comes back as an error result, not a crash",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const error = yield* Effect.flip(server.call("get_item", { id: "missing/item" }, Created));

        expect(error.message).toContain("missing/item");
        expect(yield* server.call("workspace_overview", {}, Overview)).toBeDefined();
      }),
    20_000,
  );

  it.live(
    "the Cutfac app's free version tells agents what is left, then refuses a new video, one written by hand too",
    () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        const free = Context.get(yield* Layer.build(tempWorkspace("free")), Workspace);
        const data = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-data-" });
        const app = yield* mcpServer(free.root, { env: { CUTFAC_DESKTOP_DATA: data } });

        expect(
          (yield* server.call("workspace_overview", {}, FreeVersion)).freeVersion,
        ).toBeUndefined();
        expect((yield* app.call("workspace_overview", {}, FreeVersion)).freeVersion).toBe(
          "Cutfac free version: 0 of 3 videos used on this Mac.",
        );

        yield* app.call("create_item", { title: "One" }, Created);
        yield* app.call("create_item", { title: "Two" }, Created);

        const last = yield* app.call(
          "create_item",
          { title: "Three" },
          Schema.Struct({ ...Created.fields, ...FreeVersion.fields }),
        );

        expect(last.freeVersion).toContain("3 of 3 videos used");
        expect(last.freeVersion).toContain("https://cutfac.com/pricing");

        const refused = yield* Effect.flip(app.call("create_item", { title: "Four" }, Created));

        expect(refused.message).toContain("License Key");

        expect(yield* app.call("update_item", { id: last.id, status: "review" }, Updated)).toEqual({
          status: "review",
        });

        const items = free.config.paths.items;

        yield* free.writeText(
          `${items}/handmade/item.yaml`,
          yield* free.readText(`${items}/${last.id}/item.yaml`),
        );

        const handmade = yield* Effect.flip(
          app.call("update_item", { id: "handmade", status: "review" }, Updated),
        );

        expect(handmade.message).toContain("wasn't made by create_item");
      }),
    60_000,
  );

  it.live(
    "agents can check a template and fill its inputs",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;

        yield* upToDateAgents;
        const server = yield* mcpServer(ws.root);

        yield* server.call(
          "save_format",
          {
            id: "art",
            title: "Art motion",
            skills: [{ name: "art-motion" }],
            inputs: [
              {
                id: "style",
                title: "Style",
                choices: [
                  { id: "swiss", title: "Swiss" },
                  { id: "neon", title: "Neon" },
                ],
                default: "swiss",
              },
            ],
          },
          Created,
        );

        const format = yield* server.call("get_format", { id: "art" }, FormatDetail);

        expect(format.id).toBe("art");
        expect(format.readme).toBeUndefined();

        const check = yield* server.call("check_format", { id: "art" }, FormatCheck);

        expect(check.ready).toBe(false);
        expect(check.problems).toEqual([{ kind: "skill", subject: "art-motion" }]);

        const created = yield* server.call(
          "create_item",
          { title: "Morning routine", format: "art", inputs: { style: "neon" } },
          Created,
        );

        const item = yield* server.call("get_item", { id: created.id }, ItemInputs);

        expect(item.doc.inputs).toEqual({ style: "neon" });
      }),
    20_000,
  );
});
