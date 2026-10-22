import { createServer, type AddressInfo } from "node:net";

/** The local server only listens on loopback. */
export const HOST = "127.0.0.1";

/**
 * Checks that `port` is free by binding and releasing it; port 0 picks any free one. Rejects with
 * EADDRINUSE, so a fixed port held by something else is not mistaken for our own server.
 */
export function probePort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();

    server.once("error", reject);
    server.listen(port, HOST, () => {
      // SAFETY: the server listens on a TCP host and port, so address() is an AddressInfo.
      const bound = server.address() as AddressInfo;

      server.close(() => resolve(bound.port));
    });
  });
}

/** `last` if it is still free, so the board's origin and its saved preferences stay put. */
export async function freePort(last: number | undefined): Promise<number> {
  if (last !== undefined) {
    try {
      return await probePort(last);
    } catch {
      // Something else took it since; the board starts with default preferences.
    }
  }

  return probePort(0);
}
