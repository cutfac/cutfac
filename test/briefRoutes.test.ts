import { expect } from "bun:test";
import { join } from "node:path";

import { Effect, type Schema } from "effect";

import { Workspace } from "../src/core/workspace.ts";
import { briefRoutes } from "../src/server/brief.ts";
import { testEffect } from "./effect.ts";
import { jsonOf, workspaceRoutes } from "./routeSupport.ts";
import { tempWorkspace } from "./support.ts";

const it = testEffect(tempWorkspace("Brief routes"));

/** The brief routes on the test's workspace. */
const briefServer = Effect.gen(function* () {
  const { send, sendJson } = yield* workspaceRoutes(briefRoutes);

  return {
    send: (init: RequestInit = {}) => send("/api/brief", init),
    patch: (body: Schema.JsonObject) => sendJson("PATCH", "/api/brief", body),
  };
});

it.live("the board reads an empty brief until someone writes one", () =>
  Effect.gen(function* () {
    const ws = yield* Workspace;
    const server = yield* briefServer;

    const response = yield* server.send();

    expect(response.status).toBe(200);
    expect(yield* jsonOf(response)).toEqual({
      path: join(ws.root, "brief.md"),
      exists: false,
      purpose: null,
      platforms: [],
      body: "",
    });
  }),
);

it.live("the board changes only what it sends, and refuses what the brief can't hold", () =>
  Effect.gen(function* () {
    const server = yield* briefServer;

    yield* server.patch({ purpose: "tips", body: "Cooking tips." });
    const changed = yield* server.patch({ platforms: ["shorts"] });

    expect(yield* jsonOf(changed)).toMatchObject({
      exists: true,
      purpose: "tips",
      platforms: ["shorts"],
      body: "Cooking tips.",
    });

    const refused = yield* server.patch({ platforms: ["myspace"] });

    expect(refused.status).toBe(400);
    expect(yield* jsonOf(yield* server.send())).toMatchObject({ platforms: ["shorts"] });
  }),
);
