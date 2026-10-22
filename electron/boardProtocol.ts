import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import { boardFile, SCHEME } from "./boardPages.ts";

/** Before the app is ready: lets the board's scheme keep storage and fetch like a web origin. */
export function registerBoardScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

/**
 * Serves the built board from `root`. Anything else is missing, such as the API, which only a
 * workspace's server answers.
 */
export function serveBoard(root: string): void {
  protocol.handle(SCHEME, async (request) => {
    const file = boardFile(root, request.url);

    if (file === undefined || !(await isFile(file))) return new Response(null, { status: 404 });

    return net.fetch(pathToFileURL(file).href);
  });
}
