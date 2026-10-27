// The web handler is the test's entry point, so it provides every layer the routes need.
// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform, type BunServices } from "@effect/platform-bun";
import { Context, Effect, Layer, Option, type Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { RunRegistry } from "../src/core/agentRun.ts";
import { ImportRuns } from "../src/core/importRun.ts";
import type { Workspace } from "../src/core/workspace.ts";
import { DesktopData } from "../src/plan.ts";
import { routes } from "../src/server/app.ts";

export const jsonOf = (response: Response) =>
  Effect.promise((): Promise<Schema.Json> => response.json());

/**
 * Requests to routes handled in this process, as `fetch` makes them; `dispose` runs when the test
 * ends.
 */
export const requester = (
  handle: (request: Request) => Promise<Response>,
  dispose: () => Promise<void>,
) => {
  const send = (path: string, init: RequestInit = {}) =>
    Effect.promise(() => handle(new Request(`http://localhost${path}`, init)));

  const sendJson = (method: string, path: string, body: Schema.JsonObject) =>
    send(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return Effect.as(
    Effect.addFinalizer(() => Effect.promise(dispose)),
    { send, sendJson },
  );
};

/**
 * The board's API on the test's workspace, finding only the agents the test's PATH has. With
 * `desktopData`, it is the desktop app's, which keeps its count of videos there. Its runs stop with
 * the test, before the workspace goes.
 */
export const boardServer = (options: { readonly desktopData?: string } = {}) =>
  Effect.gen(function* () {
    // Route handlers read their services per request, as `serve` does from the server's context.
    const base = yield* Effect.context<Workspace | BunServices.BunServices>();

    const services = yield* Layer.build(
      Layer.mergeAll(
        RunRegistry.layer(undefined),
        ImportRuns.layer,
        FetchHttpClient.layer,
        BunHttpPlatform.layer,
        Layer.succeed(DesktopData, Option.fromUndefinedOr(options.desktopData)),
      ),
    );

    const app = routes({}).pipe(
      Layer.provide(Layer.merge(Layer.succeedContext(base), BunHttpPlatform.layer)),
    );

    const web = HttpRouter.toWebHandler(app, { disableLogger: true });
    const context = Context.merge(base, services);
    const requests = yield* requester((request) => web.handler(request, context), web.dispose);

    return { ...requests, runs: Context.get(services, RunRegistry) };
  });

/** The routes of a router that needs only the workspace and the platform. */
export const workspaceRoutes = <
  R extends
    | HttpRouter.HttpRouter
    | HttpRouter.Request<"Requires", any>
    | HttpRouter.Request<"GlobalRequires", any>
    | HttpRouter.Request<"Error", any>
    | HttpRouter.Request<"GlobalError", any>,
>(
  router: Layer.Layer<never, never, R>,
) =>
  Effect.gen(function* () {
    const context = yield* Effect.context<Workspace | BunServices.BunServices>();

    const app = router.pipe(
      Layer.provide(Layer.merge(Layer.succeedContext(context), BunHttpPlatform.layer)),
    );

    const web = HttpRouter.toWebHandler(app, { disableLogger: true });

    return yield* requester((request) => web.handler(request, context), web.dispose);
  });

export type BoardServer = Effect.Success<ReturnType<typeof boardServer>>;
