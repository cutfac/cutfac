import { Option, Schema } from "effect";

import { RunEvent } from "../../../src/core/agentParse.ts";
import { apiUrl, q } from "./client.ts";

/**
 * What a run stream says: what the run is about (first on every connect), then its events. On an
 * item the subject is a request; on an import, a turn.
 */
export type RunMessage = RunEvent | { readonly type: "run"; readonly subject: string };

export function eventData(event: Event): string {
  // SAFETY: EventSource dispatches named server-sent events as MessageEvents with string data.
  return (event as MessageEvent<string>).data;
}

/** A stream of server-sent events from the local server. */
export const openEvents = (path: string) => new EventSource(apiUrl(path));

const decodeRunEvent = Schema.decodeUnknownOption(Schema.fromJsonString(RunEvent));

/**
 * The latest agent run at `path`: a `run` message naming what it is about, its events from the
 * start, then live ones. A reconnect replays it all again from `run`.
 */
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

/** The item's latest agent run, about one of its requests. */
export const onAgentRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/item/run${q(id)}`, listener);

/** The import's latest agent run, about one of its turns. */
export const onImportRun = (id: string, listener: (message: RunMessage) => void) =>
  onRun(`/api/import/run${q(id)}`, listener);

/**
 * Workspace file changes, so agent writes appear live. Every subscriber shares one
 * EventSource: browsers allow only six HTTP/1.1 connections per origin.
 */
const changeListeners = new Set<() => void>();

let changeSource: EventSource | undefined;

export function onWorkspaceChange(listener: () => void): () => void {
  changeListeners.add(listener);

  if (changeSource === undefined) {
    changeSource = new EventSource(apiUrl("/api/events"));
    changeSource.addEventListener("change", () => {
      for (const notify of changeListeners) notify();
    });
  }

  return () => {
    changeListeners.delete(listener);

    if (changeListeners.size === 0) {
      changeSource?.close();
      changeSource = undefined;
    }
  };
}
