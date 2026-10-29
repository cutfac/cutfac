import { Option, Schema } from "effect";

import { RunEvent } from "../../../src/core/agentParse.ts";
import { apiUrl, q } from "./client.ts";

export type RunMessage = RunEvent | { readonly type: "run"; readonly subject: string };

export function eventData(event: Event): string {
  // SAFETY: EventSource dispatches named server-sent events as MessageEvents with string data.
  return (event as MessageEvent<string>).data;
}

export const openEvents = (path: string) => new EventSource(apiUrl(path));

/**
 * How long a stream may stay quiet, pings included, before it counts as dead: more than twice the
 * server's ping interval. A proxied stream goes quiet without closing when the server behind it
 * restarts, as under `desktop:dev`.
 */
export const SILENT_MS = 60_000;

/**
 * `path`'s stream, opened again when it goes quiet. `onReopen` hears each connection after the
 * first, as what was sent while it was down went unheard.
 */
function watchedStream(
  path: string,
  listen: (source: EventSource, heard: () => void) => void,
  onReopen: () => void = () => {},
) {
  let source: EventSource | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let connected = false;

  const heard = () => {
    clearTimeout(silence);
    silence = setTimeout(open, SILENT_MS);
  };

  function open() {
    source?.close();
    source = openEvents(path);
    source.addEventListener("open", () => {
      if (connected) onReopen();

      connected = true;
      heard();
    });
    source.addEventListener("ping", heard);
    listen(source, heard);
    heard();
  }

  open();

  return () => {
    clearTimeout(silence);
    source?.close();
  };
}

const decodeRunEvent = Schema.decodeUnknownOption(Schema.fromJsonString(RunEvent));

// A run's stream starts by replaying the run so far, so one opened again catches up by itself.
const onRun = (path: string, listener: (message: RunMessage) => void) =>
  watchedStream(path, (source, heard) => {
    source.addEventListener("run", (e) => {
      heard();
      listener({ type: "run", subject: eventData(e) });
    });

    source.addEventListener("agent", (e) => {
      heard();

      const event = decodeRunEvent(eventData(e));

      if (Option.isSome(event)) listener(event.value);
    });
  });

export const onAgentRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/item/run${q(id)}`, listener);

export const onImportRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/import/run${q(id)}`, listener);

// Subscribers share one EventSource: browsers allow only six HTTP/1.1 connections per origin.
const changeListeners = new Set<() => void>();

const notifyAll = () => {
  for (const notify of changeListeners) notify();
};

const connectChanges = () =>
  watchedStream(
    "/api/events",
    (source, heard) =>
      source.addEventListener("change", () => {
        heard();
        notifyAll();
      }),
    notifyAll,
  );

let closeChanges: (() => void) | undefined;

export function onWorkspaceChange(listener: () => void): () => void {
  changeListeners.add(listener);
  closeChanges ??= connectChanges();

  return () => {
    changeListeners.delete(listener);

    if (changeListeners.size === 0) {
      closeChanges?.();
      closeChanges = undefined;
    }
  };
}
