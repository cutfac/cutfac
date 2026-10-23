import { Stream } from "effect";
import { Sse } from "effect/encoding";
import { HttpServerResponse } from "effect/http";

const PING_EVERY = "25 seconds";

const encoder = new TextEncoder();

export const sseEvent = (event: string, data: string) =>
  encoder.encode(Sse.encoder.write(Sse.Event.make({ event, id: undefined, data })));

/** A ping now and then, so proxies and the browser keep an idle stream open. */
const keepAlive = Stream.map(Stream.tick(PING_EVERY), () => sseEvent("ping", ""));

export const eventStream = <E>(events: Stream.Stream<Uint8Array, E>) =>
  HttpServerResponse.stream(Stream.merge(events, keepAlive), {
    contentType: "text/event-stream",
    headers: { "cache-control": "no-cache" },
  });
