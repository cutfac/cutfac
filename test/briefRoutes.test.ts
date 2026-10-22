import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform } from "@effect/platform-bun";
import { Layer, ManagedRuntime, Schema } from "effect";
import { HttpRouter } from "effect/http";

import { briefRoutes } from "../src/server/brief.ts";
import { makeWorkspace, type TestWorkspace } from "./support.ts";

/** The brief routes on a test workspace. */
const makeServer = async (t: TestWorkspace) => {
  const runtime = ManagedRuntime.make(t.layer);
  const context = await runtime.context();

  const web = HttpRouter.toWebHandler(
    briefRoutes.pipe(Layer.provide(Layer.merge(t.layer, BunHttpPlatform.layer))),
    { disableLogger: true },
  );

  const send = (init: RequestInit = {}) =>
    web.handler(new Request("http://localhost/api/brief", init), context);

  const patch = (body: Schema.JsonObject) =>
    send({
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  const dispose = async () => {
    await web.dispose();
    await runtime.dispose();
  };

  return { send, patch, dispose };
};

let t: TestWorkspace;

let server: Awaited<ReturnType<typeof makeServer>>;

beforeEach(async () => {
  t = await makeWorkspace("Brief routes");
  server = await makeServer(t);
});

afterEach(async () => {
  await server.dispose();
  await t.remove();
});

test("the board reads an empty brief until someone writes one", async () => {
  const response = await server.send();

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    path: join(t.root, "brief.md"),
    exists: false,
    purpose: null,
    platforms: [],
    body: "",
  });
});

test("the board changes only what it sends, and refuses what the brief can't hold", async () => {
  await server.patch({ purpose: "tips", body: "Cooking tips." });
  const changed = await server.patch({ platforms: ["shorts"] });

  expect(await changed.json()).toMatchObject({
    exists: true,
    purpose: "tips",
    platforms: ["shorts"],
    body: "Cooking tips.",
  });

  const refused = await server.patch({ platforms: ["myspace"] });

  expect(refused.status).toBe(400);
  expect(await (await server.send()).json()).toMatchObject({ platforms: ["shorts"] });
});
