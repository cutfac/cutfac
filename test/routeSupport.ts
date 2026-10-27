// @effect-diagnostics strictEffectProvide:off
import { BunHttpPlatform, type BunServices } from "@effect/platform-bun";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/http";

import { RunRegistry } from "../src/core/agentRun.ts";
import { ImportRuns } from "../src/core/importRun.ts";
import type { Workspace } from "../src/core/workspace.ts";
import { DesktopData } from "../src/plan.ts";
import { routes } from "../src/server/app.ts";

export const jsonOf = (response: Response) =>
  Effect.promise((): Promise<Schema.Json> => response.json());

export const decodedOf = <A>(schema: Schema.Decoder<A>, response: Response) =>
  Effect.flatMap(jsonOf(response), Schema.decodeUnknownEffect(schema));

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

export const boardServer = (options: { readonly desktopData?: string } = {}) =>
  Effect.gen(function* () {
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
