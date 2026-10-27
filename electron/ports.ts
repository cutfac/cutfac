import { createServer, type AddressInfo } from "node:net";

import { Effect, Option, Schema } from "effect";

/** The local server only listens on loopback. */
export const HOST = "127.0.0.1";

export class PortTaken extends Schema.TaggedError<PortTaken>()("PortTaken", {
  message: Schema.String,
}) {}

export const bindPort = (port: number) =>
  Effect.callback<number, PortTaken>((resume) => {
    const server = createServer();

    server.once("error", (error) => resume(Effect.fail(new PortTaken({ message: error.message }))));
    server.listen(port, HOST, () => {
      // SAFETY: the server listens on a TCP host and port, so address() is an AddressInfo.
      const bound = server.address() as AddressInfo;

      server.close(() => resume(Effect.succeed(bound.port)));
    });

    return Effect.sync(() => server.close());
  });

/** `last` if it is still free, so the board's origin and its saved preferences stay put. */
export const freePort = (last: Option.Option<number>) =>
  Option.match(last, {
    onNone: () => bindPort(0),
    onSome: (port) => bindPort(port).pipe(Effect.catchTag("PortTaken", () => bindPort(0))),
  });
