import { describe, expect } from "bun:test";

import { Effect, FileSystem, Layer } from "effect";

import { testEffect } from "./effect.ts";
import { boardServer, jsonOf } from "./routeSupport.ts";
import { fakeAgents, tempWorkspace } from "./support.ts";

const it = testEffect(Layer.merge(tempWorkspace("Free"), fakeAgents));

describe("the desktop app's free version on the board", () => {
  it.live("counts the videos made and refuses a new one past the limit", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const data = yield* fs.makeTempDirectoryScoped({ prefix: "cutfac-app-data-" });
      const { send, sendJson } = yield* boardServer({ desktopData: data });

      const plan = Effect.flatMap(send("/api/plan"), jsonOf);

      expect(yield* plan).toEqual({ edition: "desktop", paid: false, used: 0, limit: 3 });

      for (const title of ["One", "Two", "Three"]) {
        expect((yield* sendJson("POST", "/api/items", { title })).status).toBe(200);
      }

      const refused = yield* sendJson("POST", "/api/items", { title: "Four" });

      expect(refused.status).toBe(402);
      expect(yield* jsonOf(refused)).toEqual({
        error: expect.stringContaining("cutfac.com/pricing"),
      });
      expect(yield* plan).toMatchObject({ used: 3 });

      const patched = yield* sendJson("PATCH", "/api/item?id=one", { status: "review" });

      expect(patched.status).toBe(200);
    }),
  );

  it.live("the open-source board has no limit", () =>
    Effect.gen(function* () {
      const { send } = yield* boardServer();

      expect(yield* jsonOf(yield* send("/api/plan"))).toEqual({ edition: "open-source" });
    }),
  );
});
