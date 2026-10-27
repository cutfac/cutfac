import { describe, expect } from "bun:test";

import { Effect, Layer } from "effect";

import { createImport } from "../src/core/imports.ts";
import { testEffect } from "./effect.ts";
import { boardServer, jsonOf } from "./routeSupport.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Routes"), fakeAgents));

describe("routes", () => {
  it.live("lists, reads, and closes imports, and starts none without knowing its own launch", () =>
    Effect.gen(function* () {
      const { send, sendJson } = yield* boardServer();

      expect(yield* jsonOf(yield* send("/api/imports"))).toEqual([]);
      expect((yield* send("/api/import?id=zzz")).status).toBe(404);

      const link = "https://example.com/pack";
      const refused = yield* sendJson("POST", "/api/imports", { link, agent: "claude" });

      expect(refused.status).toBe(400);
      expect(yield* jsonOf(refused)).toMatchObject({
        error: expect.stringContaining("copy the import prompt"),
      });
      expect(yield* jsonOf(yield* send("/api/imports"))).toEqual([]);

      const withFile = new FormData();
      withFile.append("link", link);
      withFile.append("files", new File(["brief"], "brief.md"));
      const refusedWithFile = yield* send("/api/imports", { method: "POST", body: withFile });

      expect(yield* jsonOf(refusedWithFile)).toMatchObject({
        error: expect.stringContaining("copy the import prompt"),
      });
      expect(yield* jsonOf(yield* send("/api/imports"))).toEqual([]);

      const { id } = yield* createImport({ link, agent: "claude" });
      const blank = yield* sendJson("POST", `/api/import/reply?id=${id}`, { body: "  " });

      expect(yield* jsonOf(blank)).toMatchObject({ error: "Write a reply first" });

      const blankWithFile = new FormData();
      blankWithFile.append("body", "  ");
      blankWithFile.append("files", new File(["png"], "logo.png"));

      const refusedReply = yield* send(`/api/import/reply?id=${id}`, {
        method: "POST",
        body: blankWithFile,
      });

      expect(yield* jsonOf(refusedReply)).toMatchObject({ error: "Write a reply first" });
      expect((yield* sendJson("POST", `/api/import/reply?id=${id}`, { allow: true })).status).toBe(
        400,
      );

      expect(yield* jsonOf(yield* send(`/api/import?id=${id}`))).toMatchObject({
        id,
        running: false,
        dir: `.cutfac/imports/${id}`,
        references: [],
        doc: { link, allowed: false, closed: false },
      });

      const stopped = yield* send(`/api/import/stop?id=${id}`, { method: "POST" });

      expect(yield* jsonOf(stopped)).toMatchObject({ id, running: false });

      const closed = yield* send(`/api/import/close?id=${id}`, { method: "POST" });

      expect(yield* jsonOf(closed)).toMatchObject({ id, running: false, doc: { closed: true } });
    }),
  );
});
