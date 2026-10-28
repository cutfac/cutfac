import { Option, Schema } from "effect";

import { RunEvent } from "../../../src/core/agentParse.ts";
import { apiUrl, q } from "./client.ts";

export type RunMessage = RunEvent | { readonly type: "run"; readonly subject: string };

export function eventData(event: Event): string {
  // SAFETY: EventSource dispatches named server-sent events as MessageEvents with string data.
  return (event as MessageEvent<string>).data;
}

export const openEvents = (path: string) => new EventSource(apiUrl(path));

const decodeRunEvent = Schema.decodeUnknownOption(Schema.fromJsonString(RunEvent));

function onRun(path: string, listener: (message: RunMessage) => void): () => void {
  const source = openEvents(path);

  source.addEventListener("run", (e) => {
    listener({ type: "run", subject: eventData(e) });
  });

  source.addEventListener("agent", (e) => {
    const event = decodeRunEvent(eventData(e));

    if (Option.isSome(event)) listener(event.value);
  });

  return () => source.close();
}

export const onAgentRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/item/run${q(id)}`, listener);

export const onImportRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/import/run${q(id)}`, listener);

/**
 * How long the change stream may stay quiet, pings included, before it counts as dead: more than
 * twice the server's ping interval. A proxied stream goes quiet without closing when the server
 * behind it restarts, as under `desktop:dev`.
 */
export const SILENT_MS = 60_000;

// Subscribers share one EventSource: browsers allow only six HTTP/1.1 connections per origin.
const changeListeners = new Set<() => void>();

const notifyAll = () => {
  for (const notify of changeListeners) notify();
};

/**
 * The change stream, opened again when it goes quiet. Each connection after the first tells every
 * listener to reload, as what changed while it was down went unheard.
 */
function connectChanges() {
  let source: EventSource | undefined;
  let silence: ReturnType<typeof setTimeout> | undefined;
  let connected = false;

  const heard = () => {
    clearTimeout(silence);
    silence = setTimeout(open, SILENT_MS);
  };

  function open() {
    source?.close();
    source = new EventSource(apiUrl("/api/events"));
    source.addEventListener("open", () => {
      if (connected) notifyAll();

      connected = true;
      heard();
    });
    source.addEventListener("ping", heard);
    source.addEventListener("change", () => {
      heard();
      notifyAll();
    });
    heard();
  }

  open();

  return () => {
    clearTimeout(silence);
    source?.close();
  };
}

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
