import { describe, expect } from "bun:test";

import { Effect, Layer } from "effect";

import { requestEdit, resolveEdit, saveVariant } from "../src/core/edits.ts";
import { createItem } from "../src/core/items.ts";
import { Workspace } from "../src/core/workspace.ts";
import { testEffect } from "./effect.ts";
import { boardServer, jsonOf } from "./routeSupport.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Routes"), fakeAgents));

describe("routes", () => {
  it.live("health and unknown API routes", () =>
    Effect.gen(function* () {
      const { send } = yield* boardServer();

      const health = yield* send("/api/health");

      expect(health.status).toBe(200);
      expect(yield* jsonOf(health)).toEqual({ ok: true });

      const missing = yield* send("/api/nope");

      expect(missing.status).toBe(404);
      expect(yield* jsonOf(missing)).toEqual({ error: "No such API route" });
    }),
  );

  it.live("the item list keeps a resolved request while its versions wait for a pick", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const { send } = yield* boardServer();
      const VIDEO = "[9x16] video.mp4";
      const item = yield* createItem({ title: "Takes" });
      const media = `${item.dir}/${VIDEO}`;

      yield* ws.writeText(media, "first");

      const { feedback } = yield* requestEdit(item.id, {
        body: "Punchier",
        media: VIDEO,
        variants: 2,
      });

      yield* ws.writeText(media, "big captions");
      yield* saveVariant(item.id, feedback.id, "Big captions");
      yield* resolveEdit(item.id, feedback.id, "One take");

      const listed = yield* send("/api/items");

      expect(yield* jsonOf(listed)).toMatchObject([
        { openFeedback: 0, requests: [{ id: feedback.id, status: "resolved" }] },
      ]);
    }),
  );

  it.live("creates, lists, patches, and reads an item", () =>
    Effect.gen(function* () {
      const { send, sendJson } = yield* boardServer();

      const created = yield* sendJson("POST", "/api/items", { title: "First cut" });

      expect(created.status).toBe(200);
      expect(yield* jsonOf(created)).toMatchObject({ id: "first-cut", running: false });

      const listed = yield* send("/api/items");

      expect(yield* jsonOf(listed)).toMatchObject([{ id: "first-cut", status: "drafting" }]);

      const patched = yield* sendJson("PATCH", "/api/item?id=first-cut", { status: "review" });

      expect(yield* jsonOf(patched)).toMatchObject({ doc: { status: "review" } });

      const read = yield* send("/api/item?id=first-cut");

      expect(yield* jsonOf(read)).toMatchObject({ id: "first-cut", doc: { title: "First cut" } });
    }),
  );

  it.live("lists every format with what it lacks, and makes items with its inputs", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const { send, sendJson } = yield* boardServer();

      yield* ws.writeText(
        "formats/art/format.yaml",
        "title: Art\nrequires: [surely-not-installed-cutfac]\ninputs:\n  - id: style\n    title: Style\n    choices: [{ id: swiss, title: Swiss }, { id: neon, title: Neon }]\n    default: swiss\n",
      );
      yield* ws.writeText("formats/broken/format.yaml", "summary: no title\n");

      const statuses = yield* send("/api/formats/status");

      expect(yield* jsonOf(statuses)).toMatchObject([
        {
          id: "art",
          format: { doc: { title: "Art" } },
          check: {
            ready: false,
            problems: [{ kind: "program", subject: "surely-not-installed-cutfac" }],
          },
        },
        { id: "broken", check: { ready: false, problems: [{ kind: "spec" }] } },
      ]);

      const created = yield* sendJson("POST", "/api/items", {
        title: "Morning routine",
        format: "art",
        inputs: { style: "neon" },
      });

      expect(yield* jsonOf(created)).toMatchObject({ doc: { inputs: { style: "neon" } } });

      const wrong = yield* sendJson("POST", "/api/items", {
        title: "Evening routine",
        format: "art",
        inputs: { style: "pastel" },
      });

      expect(wrong.status).toBe(400);
    }),
  );

  it.live("undoes and redoes item changes", () =>
    Effect.gen(function* () {
      const { sendJson } = yield* boardServer();

      yield* sendJson("POST", "/api/items", { title: "Cut" });

      const patched = yield* sendJson("PATCH", "/api/item?id=cut", { title: "Final cut" });

      expect(yield* jsonOf(patched)).toMatchObject({
        doc: { title: "Final cut" },
        history: { cursor: 1, entries: [{ kind: "details", after: { title: "Final cut" } }] },
      });

      const undone = yield* sendJson("POST", "/api/item/history/undo?id=cut", {});

      expect(yield* jsonOf(undone)).toMatchObject({
        doc: { title: "Cut" },
        history: { cursor: 0 },
      });

      const again = yield* sendJson("POST", "/api/item/history/undo?id=cut", {});

      expect(again.status).toBe(400);
      expect(yield* jsonOf(again)).toEqual({ error: "Nothing to undo" });

      const redone = yield* sendJson("POST", "/api/item/history/redo?id=cut", {});

      expect(yield* jsonOf(redone)).toMatchObject({ doc: { title: "Final cut" } });

      const start = yield* sendJson("POST", "/api/item/history/goto?id=cut", {});

      expect(yield* jsonOf(start)).toMatchObject({ doc: { title: "Cut" } });

      const missing = yield* sendJson("POST", "/api/item/history/version?id=cut", {
        versionId: "x",
      });

      expect(missing.status).toBe(404);
    }),
  );

  it.live("maps failures to statuses with a message", () =>
    Effect.gen(function* () {
      const { send, sendJson } = yield* boardServer();

      const missing = yield* send("/api/item?id=missing");

      expect(missing.status).toBe(404);
      expect(yield* jsonOf(missing)).toEqual({ error: "Item not found: missing" });

      const blank = yield* sendJson("POST", "/api/items", { title: "  " });

      expect(blank.status).toBe(400);

      const malformed = yield* send("/api/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      });

      expect(malformed.status).toBe(400);
      expect((yield* send("/api/item")).status).toBe(400);
    }),
  );
});
