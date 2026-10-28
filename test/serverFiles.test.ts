import { describe, expect, test } from "bun:test";

import { Effect, Layer, Schema } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { parseRange } from "../src/server/files.ts";
import { testEffect } from "./effect.ts";
import { boardServer, decodedOf, jsonOf } from "./routeSupport.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Routes"), fakeAgents));

describe("parseRange", () => {
  test("reads one byte range against the file size", () => {
    expect(parseRange(undefined, 10)).toEqual({ kind: "whole" });
    expect(parseRange("bytes=2-5", 10)).toEqual({ kind: "slice", start: 2, end: 5 });
    expect(parseRange("bytes=4-", 10)).toEqual({ kind: "slice", start: 4, end: 9 });
    expect(parseRange("bytes=-3", 10)).toEqual({ kind: "slice", start: 7, end: 9 });
    expect(parseRange("bytes=8-100", 10)).toEqual({ kind: "slice", start: 8, end: 9 });
  });

  test("gives the whole file for headers it does not understand", () => {
    expect(parseRange("bytes=0-1,4-5", 10)).toEqual({ kind: "whole" });
    expect(parseRange("items=0-1", 10)).toEqual({ kind: "whole" });
    expect(parseRange("bytes=-", 10)).toEqual({ kind: "whole" });
  });

  test("refuses ranges past the end", () => {
    expect(parseRange("bytes=10-", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=5-2", 10)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=-0", 10)).toEqual({ kind: "unsatisfiable" });
  });
});

describe("routes", () => {
  it.live("uploads media and refuses files that are not media", () =>
    Effect.gen(function* () {
      const { send, sendJson } = yield* boardServer();

      const upload = (file: File) => {
        const form = new FormData();
        form.append("file", file);

        return send("/api/item/media?id=clip", { method: "POST", body: form });
      };

      yield* sendJson("POST", "/api/items", { title: "Clip" });

      const video = yield* upload(new File([new Uint8Array([0, 1, 2])], "take 1.mp4"));

      expect(video.status).toBe(200);
      expect(yield* jsonOf(video)).toMatchObject({
        doc: { status: "drafting" },
        media: [{ name: "take 1.mp4", kind: "video" }],
      });

      const text = yield* upload(new File(["hi"], "notes.txt"));

      expect(text.status).toBe(400);
    }),
  );

  it.live(
    "keeps dropped files as references and lists them on the request that attached them",
    () =>
      Effect.gen(function* () {
        const ws = yield* Workspace;
        const { send, sendJson } = yield* boardServer();

        yield* sendJson("POST", "/api/items", { title: "Clip" });

        const form = new FormData();
        form.append("files", new File(["png"], "logo.png"));
        form.append("paths", "/logo.png");
        form.append("files", new File(["jpg"], "a.jpg"));
        form.append("paths", "/photos/a.jpg");

        const added = yield* send("/api/item/references?id=clip", { method: "POST", body: form });

        expect(added.status).toBe(200);
        expect(yield* jsonOf(added)).toMatchObject({
          added: ["references/logo.png", "references/photos"],
          item: {
            media: [],
            references: [
              { path: "references/logo.png", kind: "image" },
              { path: "references/photos", dir: true, files: 1 },
            ],
          },
        });

        const edit = yield* sendJson("POST", "/api/item/edit?id=clip", {
          agent: "queue",
          body: "Put the logo in the corner",
          attachments: ["references/logo.png"],
        });

        const { prompt } = yield* decodedOf(Schema.Struct({ prompt: Schema.String }), edit);

        expect(prompt).toContain(`${ws.root}/items/clip/references/logo.png`);

        const removed = yield* sendJson("POST", "/api/item/references/remove?id=clip", {
          path: "references/photos",
        });

        expect(yield* jsonOf(removed)).toMatchObject({
          references: [{ path: "references/logo.png" }],
        });

        const outside = yield* sendJson("POST", "/api/item/references/remove?id=clip", {
          path: "item.yaml",
        });

        expect(outside.status).toBe(400);
      }),
  );

  it.live("serves workspace files with byte ranges and refuses everything else", () =>
    Effect.gen(function* () {
      const ws = yield* Workspace;
      const { send } = yield* boardServer();

      yield* ws.writeBytes(
        "items/clip/[9x16] video.mp4",
        new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
      );

      const path = `/files/${encodeURIComponent("items/clip/[9x16] video.mp4")}`;
      const whole = yield* send(path);

      expect(whole.status).toBe(200);
      expect(whole.headers.get("content-type")).toBe("video/mp4");
      expect(whole.headers.get("accept-ranges")).toBe("bytes");
      expect((yield* Effect.promise(() => whole.arrayBuffer())).byteLength).toBe(10);

      const slice = yield* send(path, { headers: { range: "bytes=2-5" } });

      expect(slice.status).toBe(206);
      expect(slice.headers.get("content-range")).toBe("bytes 2-5/10");
      expect([...new Uint8Array(yield* Effect.promise(() => slice.arrayBuffer()))]).toEqual([
        2, 3, 4, 5,
      ]);

      const past = yield* send(path, { headers: { range: "bytes=20-" } });

      expect(past.status).toBe(416);
      expect(past.headers.get("content-range")).toBe("bytes */10");

      expect((yield* send("/files/cutfac.yaml")).status).toBe(403);
      expect((yield* send(`/files/${encodeURIComponent("../outside.mp4")}`)).status).toBe(403);
      expect((yield* send("/files/items/clip/missing.mp4")).status).toBe(404);
    }),
  );
});
