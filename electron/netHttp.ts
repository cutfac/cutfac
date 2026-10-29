import { Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { app, net } from "electron";

// Node's fetch ignores the system's proxy and trusts only the certificates it ships with, so behind
// a corporate proxy or TLS inspection it can't reach cutfac.com. Chromium's network stack follows
// the system on both. It can only be used once the app is ready.
const netFetch = (input: string | URL | Request, init?: RequestInit) =>
  app.whenReady().then(() => net.fetch(input instanceof URL ? input.href : input, init));

/** The main process's HTTP client, which reaches the internet the way the system is set up to. */
export const NetHttpClient = FetchHttpClient.layer.pipe(
  // SAFETY: the client only calls fetch; Bun's type adds a `preconnect` that Node's fetch lacks too.
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, netFetch as typeof globalThis.fetch)),
);
