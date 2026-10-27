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

// Subscribers share one EventSource: browsers allow only six HTTP/1.1 connections per origin.
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
