import { pathToFileURL } from "node:url";

import { Effect, FileSystem, Option } from "effect";
import { net, protocol } from "electron";

import { boardFile, SCHEME } from "./boardPages.ts";
import { runInMain } from "./runtime.ts";

/** Before the app is ready: lets the board's scheme keep storage and fetch like a web origin. */
export function registerBoardScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

const notFound = () => new Response(null, { status: 404 });

/** The built board's file for `url` under `root`, or 404 for anything else, such as the API. */
const respond = (root: string, url: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const file = boardFile(root, url);

    if (Option.isNone(file)) return notFound();

    const info = yield* Effect.option(fs.stat(file.value));

    if (Option.isNone(info) || info.value.type !== "File") return notFound();

    return yield* Effect.promise(() => net.fetch(pathToFileURL(file.value).href));
  });

/** Serves the built board from `root`; only a workspace's server answers the API. */
export function serveBoard(root: string): void {
  protocol.handle(SCHEME, (request) => runInMain(respond(root, request.url)));
}
